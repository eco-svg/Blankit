from flask import Blueprint, request, jsonify, session, current_app
from werkzeug.security import generate_password_hash, check_password_hash
from flask_mail import Message
from shared.models import db
from shared.models.user import User
from shared.models.reset_token import VerifyToken, ResetToken
from shared.extensions import limiter

auth = Blueprint('auth', __name__, url_prefix='/auth')

mail = None

def init_mail(mail_instance):
    global mail
    mail = mail_instance

DISTRO_REDIRECTS = {
    'ecosvg':   '/home',
    'divyanhu': '/d/home',
    'thepug':   '/pug/home',
}


def send_reset_email(user, reset_url):
    msg = Message(
        subject    = 'Reset your VEYRA password',
        recipients = [user.email],
        html       = f'''
<!DOCTYPE html>
<html>
<body style="font-family:monospace;background:#f4f7ee;padding:2rem;color:#2d4a35;margin:0">
  <div style="max-width:460px;margin:0 auto;background:#fff;
              border:1px solid #c0dd97;border-radius:12px;padding:2rem 2.5rem">
    <h2 style="color:#3B6D11;font-size:1.3rem;margin:0 0 0.5rem">VEYRA ◈</h2>
    <p style="color:#555;font-size:0.85rem;margin:0 0 1.5rem;line-height:1.6">
      Hi {user.username}, click below to reset your password.<br>
      This link expires in <strong>1 hour</strong>.
    </p>
    <div style="text-align:center;margin-bottom:1.5rem">
      <a href="{reset_url}" style="display:inline-block;background:#3B6D11;color:#fff;
                text-decoration:none;padding:0.75rem 2rem;border-radius:8px;
                font-family:monospace;font-size:0.9rem;letter-spacing:0.05em">
        Reset password →
      </a>
    </div>
    <p style="color:#888;font-size:0.75rem;line-height:1.6;margin:0">
      If you didn't request this, ignore this email — your password won't change.
    </p>
    <hr style="border:none;border-top:1px solid #e8f0d8;margin:1.5rem 0"/>
    <p style="color:#bbb;font-size:0.65rem;margin:0">
      VEYRA — veyrasupportus@gmail.com
    </p>
  </div>
</body>
</html>'''
    )
    mail.send(msg)


def send_otp_email(user, otp):
    msg = Message(
        subject    = f'{otp} is your VEYRA verification code',
        recipients = [user.email],
        html       = f'''
<!DOCTYPE html>
<html>
<body style="font-family:monospace;background:#f4f7ee;padding:2rem;color:#2d4a35;margin:0">
  <div style="max-width:460px;margin:0 auto;background:#fff;
              border:1px solid #c0dd97;border-radius:12px;padding:2rem 2.5rem">
    <h2 style="color:#3B6D11;font-size:1.3rem;margin:0 0 0.5rem">VEYRA ◈</h2>
    <p style="color:#555;font-size:0.85rem;margin:0 0 1.5rem;line-height:1.6">
      Hi {user.username}, here is your verification code:
    </p>
    <div style="background:#f4f7ee;border:2px solid #3B6D11;border-radius:10px;
                padding:1.2rem;text-align:center;margin-bottom:1.5rem">
      <span style="font-size:2.8rem;font-weight:700;letter-spacing:0.35em;
                   color:#3B6D11;font-family:monospace">{otp}</span>
    </div>
    <p style="color:#888;font-size:0.75rem;line-height:1.6;margin:0">
      This code expires in <strong>10 minutes</strong>.<br>
      If you didn't sign up for VEYRA, ignore this email.
    </p>
    <hr style="border:none;border-top:1px solid #e8f0d8;margin:1.5rem 0"/>
    <p style="color:#bbb;font-size:0.65rem;margin:0">
      VEYRA — habit tracker · veyrasupportus@gmail.com
    </p>
  </div>
</body>
</html>'''
    )
    mail.send(msg)


# ══════════════════════════════
#  REGISTER
# ══════════════════════════════
@auth.route('/register', methods=['POST'])
@limiter.limit("5 per minute")
def register():
    data     = request.get_json()
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip()
    password = data.get('password', '')
    distro   = data.get('distro', 'ecosvg')

    if distro not in DISTRO_REDIRECTS:
        return jsonify({'error': 'invalid distro'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'username already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'email already registered'}), 409

    new_user = User(
        username      = username,
        email         = email,
        password_hash = generate_password_hash(password),
        distro        = distro,
        is_verified   = False,
    )
    db.session.add(new_user)
    db.session.commit()

    token_obj = VerifyToken(user_id=new_user.id)
    db.session.add(token_obj)
    db.session.commit()

    try:
        send_otp_email(new_user, token_obj.otp)
    except Exception as e:
        current_app.logger.error(f'Mail error: {e}')
        return jsonify({'error': 'account created but email failed — contact support'}), 500

    session['pending_user_id'] = new_user.id
    session['pending_email']   = email

    return jsonify({'message': 'otp_sent', 'email': email}), 200


# ══════════════════════════════
#  VERIFY OTP
# ══════════════════════════════
@auth.route('/verify-otp', methods=['POST'])
@limiter.limit("5 per minute")
def verify_otp():
    data = request.get_json()
    otp  = data.get('otp', '').strip()

    user_id = session.get('pending_user_id')
    if not user_id:
        return jsonify({'error': 'session expired — please register again'}), 400

    token_obj = VerifyToken.query.filter_by(
        user_id=user_id, used=False
    ).order_by(VerifyToken.created_at.desc()).first()

    if not token_obj or not token_obj.is_valid():
        return jsonify({'error': 'OTP expired — request a new one'}), 400

    if token_obj.otp != otp:
        return jsonify({'error': 'incorrect OTP — try again'}), 400

    user             = User.query.get(user_id)
    user.is_verified = True
    token_obj.used   = True
    db.session.commit()

    # Regenerate session to prevent session fixation, then log in
    session.clear()
    session['user_id']  = user.id
    session['username'] = user.username
    session['distro']   = user.distro

    return jsonify({
        'message':  'verified',
        'redirect': DISTRO_REDIRECTS.get(user.distro, '/home'),
        'distro':   user.distro,
    }), 200


# ══════════════════════════════
#  RESEND OTP
# ══════════════════════════════
@auth.route('/resend-otp', methods=['POST'])
@limiter.limit("3 per minute")
def resend_otp():
    data    = request.get_json()
    email   = data.get('email', '').strip()
    user_id = session.get('pending_user_id')

    user = User.query.filter_by(email=email).first() if email else \
           User.query.get(user_id) if user_id else None

    if not user or user.is_verified:
        return jsonify({'error': 'invalid request'}), 400

    VerifyToken.query.filter_by(user_id=user.id, used=False).update({'used': True})
    db.session.commit()

    token_obj = VerifyToken(user_id=user.id)
    db.session.add(token_obj)
    db.session.commit()

    session['pending_user_id'] = user.id
    session['pending_email']   = user.email

    try:
        send_otp_email(user, token_obj.otp)
    except Exception as e:
        current_app.logger.error(f'Mail error: {e}')
        return jsonify({'error': 'failed to send OTP'}), 500

    return jsonify({'message': 'OTP resent'}), 200


# ══════════════════════════════
#  LOGIN
# ══════════════════════════════
@auth.route('/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data       = request.get_json()
    identifier = data.get('identifier', '').strip()
    method     = data.get('method', 'email')
    password   = data.get('password', '')
    distro     = data.get('distro', 'ecosvg')
    remember   = data.get('remember', False)

    if method == 'email':
        user = User.query.filter_by(email=identifier).first()
    else:
        user = User.query.filter_by(username=identifier).first()

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'invalid credentials'}), 401

    # Block cross-distro login
    if user.distro != distro:
        return jsonify({'error': f'this account belongs to {user.distro}, not {distro}'}), 403

    if not user.is_verified:
        VerifyToken.query.filter_by(user_id=user.id, used=False).update({'used': True})
        db.session.commit()
        token_obj = VerifyToken(user_id=user.id)
        db.session.add(token_obj)
        db.session.commit()
        session['pending_user_id'] = user.id
        session['pending_email']   = user.email
        try:
            send_otp_email(user, token_obj.otp)
        except Exception:
            pass
        return jsonify({'error': 'email_not_verified', 'email': user.email}), 403

    # Regenerate session to prevent session fixation
    session.clear()
    session.permanent   = remember
    session['user_id']  = user.id
    session['username'] = user.username
    session['distro']   = user.distro   # always from DB, never trust client

    return jsonify({
        'redirect': DISTRO_REDIRECTS.get(user.distro, '/home'),
        'distro':   user.distro,
    }), 200


# ══════════════════════════════
#  FORGOT PASSWORD
# ══════════════════════════════
@auth.route('/forgot-password', methods=['POST'])
@limiter.limit("3 per minute")
def forgot_password():
    data  = request.get_json()
    email = data.get('email', '').strip()
    user  = User.query.filter_by(email=email).first()
    if user and user.is_verified:
        ResetToken.query.filter_by(user_id=user.id, used=False).update({'used': True})
        db.session.commit()
        token_obj = ResetToken(user_id=user.id)
        db.session.add(token_obj)
        db.session.commit()
        reset_url = f"{request.url_root}?reset_token={token_obj.token}"
        try:
            send_reset_email(user, reset_url)
        except Exception as e:
            current_app.logger.error(f'Reset email error: {e}')
    return jsonify({'message': 'reset link sent if email exists'}), 200


@auth.route('/reset-password', methods=['POST'])
@limiter.limit("5 per minute")
def reset_password():
    data         = request.get_json()
    token        = data.get('token', '').strip()
    new_password = data.get('new_password', '')

    if not token or len(new_password) < 8:
        return jsonify({'error': 'invalid request'}), 400

    token_obj = ResetToken.query.filter_by(token=token, used=False).first()
    if not token_obj or not token_obj.is_valid():
        return jsonify({'error': 'reset link expired or already used'}), 400

    user = User.query.get(token_obj.user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404

    user.password_hash = generate_password_hash(new_password)
    token_obj.used     = True
    db.session.commit()
    return jsonify({'message': 'password updated'}), 200


# ══════════════════════════════
#  LOGOUT
# ══════════════════════════════
@auth.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'redirect': '/'}), 200


# ══════════════════════════════
#  DELETE ACCOUNT
# ══════════════════════════════
@auth.route('/delete-account', methods=['DELETE'])
def delete_account():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'not logged in'}), 401

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404

    try:
        db.session.delete(user)
        db.session.commit()
        session.clear()
        return jsonify({'message': 'account deleted'}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete account error: {e}')
        return jsonify({'error': 'deletion failed'}), 500