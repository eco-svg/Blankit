import os
import re
import requests as _http
from datetime import datetime
from flask import Blueprint, request, jsonify, session, current_app
from werkzeug.security import generate_password_hash, check_password_hash
from flask_mail import Message
from shared.extensions import db
from shared.auth.user import User
from shared.auth.reset_token import VerifyToken, ResetToken
from shared.extensions import limiter

auth = Blueprint('auth', __name__, url_prefix='/auth')

mail = None

def init_mail(mail_instance):
    global mail
    mail = mail_instance


def _send_email(to_email, subject, html):
    """Send email via Brevo HTTP API if BREVO_API_KEY is set, otherwise fall back to Flask-Mail SMTP."""
    brevo_key = os.environ.get('BREVO_API_KEY')
    if brevo_key:
        sender = os.environ.get('MAIL_USERNAME', 'veyrasupportus@gmail.com')
        r = _http.post(
            'https://api.brevo.com/v3/smtp/email',
            headers={'api-key': brevo_key, 'Content-Type': 'application/json'},
            json={
                'sender':      {'name': 'VEYRA', 'email': sender},
                'to':          [{'email': to_email}],
                'subject':     subject,
                'htmlContent': html,
            },
            timeout=10,
        )
        if not r.ok:
            raise Exception(f'Brevo {r.status_code}: {r.text}')
    else:
        msg = Message(subject=subject, recipients=[to_email], html=html)
        mail.send(msg)


DISTRO_REDIRECTS = {
    'Eco-Svg':   '/home',
    'CatalystCrew': '/d/home',
    'ThePug':   '/pug/home',
}


def send_reset_email(user, reset_url):
    _send_email(
        to_email = user.email,
        subject  = 'Reset your VEYRA password',
        html     = f'''
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
</html>''',
    )


def send_otp_email(user, otp):
    _send_email(
        to_email = user.email,
        subject  = f'{otp} is your VEYRA verification code',
        html     = f'''
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
</html>''',
    )


def send_student_decision_email(user, approved: bool):
    if approved:
        subject = 'Student verification approved ✦ — VEYRA'
        body    = f'<h2 style="color:#e8b84b">You\'re verified! ✦</h2><p>Hi {user.username}, your student status has been approved. Your verified badge is now active on your profile.</p><p>BlinkyBot AI access will unlock when available — we\'ll let you know.</p>'
    else:
        subject = 'Student verification update — VEYRA'
        body    = f'<h2>Verification update</h2><p>Hi {user.username}, we couldn\'t verify your student status with the details provided. You can re-submit from your profile at any time.</p>'
    _send_email(
        to_email = user.email,
        subject  = subject,
        html     = f'<!DOCTYPE html><html><body style="font-family:monospace;background:#0d0b08;color:#f0ebe0;padding:2rem"><div style="max-width:460px;margin:0 auto;background:#1a1612;border:1px solid #333;border-radius:12px;padding:2rem">{body}<hr style="border:none;border-top:1px solid #333;margin:1.5rem 0"/><p style="color:#555;font-size:0.7rem">VEYRA — veyrasupportus@gmail.com</p></div></body></html>',
    )


# ══════════════════════════════
#  REGISTER
# ══════════════════════════════
@auth.route('/register', methods=['POST'])
@limiter.limit("5 per minute")
def register():
    data     = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')
    distro   = data.get('distro', 'Eco-Svg')
    age_raw  = data.get('age')

    if distro not in DISTRO_REDIRECTS:
        return jsonify({'error': 'invalid distro'}), 400
    if len(username) < 2 or len(username) > 50:
        return jsonify({'error': 'username must be 2–50 characters'}), 400
    if len(password) < 8:
        return jsonify({'error': 'password must be at least 8 characters'}), 400
    if '@' not in email or '.' not in email.split('@')[-1]:
        return jsonify({'error': 'invalid email address'}), 400
    try:
        age = int(age_raw)
        if age < 1 or age > 120:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'error': 'please enter a valid age'}), 400
    if age < 13:
        return jsonify({'error': 'you must be 13 or older to create an account'}), 400

    # If email exists but unverified — update credentials and resend OTP
    existing = User.query.filter_by(email=email).first()
    if existing:
        if existing.is_verified:
            return jsonify({'error': 'email already registered'}), 409
        existing.username      = username
        existing.password_hash = generate_password_hash(password)
        existing.distro        = distro
        existing.age           = age
        VerifyToken.query.filter_by(user_id=existing.id, used=False).update({'used': True})
        db.session.commit()
        token_obj = VerifyToken(user_id=existing.id)
        db.session.add(token_obj)
        db.session.commit()
        session['pending_user_id'] = existing.id
        session['pending_email']   = email
        try:
            send_otp_email(existing, token_obj.otp)
        except Exception as e:
            current_app.logger.error(f'Mail error: {e}')
        return jsonify({'message': 'otp_sent', 'email': email}), 200

    # Username check only after email is confirmed fresh
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'username already taken'}), 409

    new_user = User(
        username      = username,
        email         = email,
        password_hash = generate_password_hash(password),
        distro        = distro,
        is_verified   = False,
        age           = age,
    )
    db.session.add(new_user)
    db.session.commit()

    token_obj = VerifyToken(user_id=new_user.id)
    db.session.add(token_obj)
    db.session.commit()

    session['pending_user_id'] = new_user.id
    session['pending_email']   = email

    # Apply pre-signup student verification if submitted
    pre = session.pop('pre_student', None)
    if pre:
        new_user.student_status       = 'pending'
        new_user.student_school       = (pre.get('school', '') or '')[:200]
        new_user.student_location     = (pre.get('location', '') or '')[:200]
        new_user.student_grade        = (pre.get('grade', '') or '')[:50]
        new_user.student_submitted_at = datetime.utcnow()
        db.session.commit()

    try:
        send_otp_email(new_user, token_obj.otp)
    except Exception as e:
        current_app.logger.error(f'Mail error: {e}')

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
@limiter.limit("5 per 15 minute")
def login():
    data       = request.get_json()
    identifier = data.get('identifier', '').strip()
    method     = data.get('method', 'email')
    password   = data.get('password', '')
    distro     = data.get('distro', 'Eco-Svg')
    remember   = data.get('remember', False)

    if method == 'email':
        user = User.query.filter_by(email=identifier).first()
    else:
        user = User.query.filter_by(username=identifier).first()

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'invalid credentials'}), 401

    if user.distro != distro:
        return jsonify({'error': 'invalid credentials'}), 401

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
        safe_host = re.sub(r'[^a-zA-Z0-9.\-:_]', '', request.host)
        reset_url = f"{request.scheme}://{safe_host}/?reset_token={token_obj.token}"
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
#  STUDENT VERIFICATION (post-login)
# ══════════════════════════════
@auth.route('/student-verify', methods=['POST'])
@limiter.limit("5 per hour")
def student_verify():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'not logged in'}), 401
    data     = request.get_json(silent=True) or {}
    school   = (data.get('school',   '') or '').strip()[:200]
    grade    = (data.get('grade',    '') or '').strip()[:50]
    location = (data.get('location', '') or '').strip()[:200]
    if not school or not grade:
        return jsonify({'error': 'school and grade are required'}), 400
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404
    if user.student_status == 'approved':
        return jsonify({'message': 'already_approved', 'status': 'approved'}), 200
    user.student_status       = 'pending'
    user.student_school       = school
    user.student_location     = location
    user.student_grade        = grade
    user.student_submitted_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'message': 'pending', 'status': 'pending'}), 200


# ══════════════════════════════
#  PRE-SIGNUP STUDENT VERIFY
# ══════════════════════════════
@auth.route('/pre-verify-student', methods=['POST'])
@limiter.limit("10 per hour")
def pre_verify_student():
    data     = request.get_json(silent=True) or {}
    school   = (data.get('school',   '') or '').strip()[:200]
    grade    = (data.get('grade',    '') or '').strip()[:50]
    location = (data.get('location', '') or '').strip()[:200]
    if not school or not grade:
        return jsonify({'error': 'school and grade are required'}), 400
    session['pre_student'] = {'school': school, 'location': location, 'grade': grade}
    return jsonify({'message': 'stored'}), 200


# ══════════════════════════════
#  STUDENT STATUS
# ══════════════════════════════
@auth.route('/student-status', methods=['GET'])
def student_status():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'not logged in'}), 401
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'not found'}), 404
    return jsonify({
        'status':   user.student_status,
        'school':   user.student_school,
        'location': user.student_location,
        'grade':    user.student_grade,
    }), 200


# ══════════════════════════════
#  ADMIN — STUDENT REVIEW
# ══════════════════════════════
@auth.route('/admin/verify', methods=['GET', 'POST'])
def admin_verify():
    from flask import render_template
    admin_pw = os.getenv('ADMIN_PASSWORD', '')

    if request.method == 'POST':
        action = request.form.get('action')

        if action == 'login':
            if not admin_pw:
                return 'ADMIN_PASSWORD env var not set.', 500
            if request.form.get('password') == admin_pw:
                session['admin_auth'] = True
            else:
                return render_template('shared/admin_verify.html',
                                       authenticated=False, pending=[], error='Wrong password.')
            return redirect(url_for('auth.admin_verify'))

        if not session.get('admin_auth'):
            return redirect(url_for('auth.admin_verify'))

        if action in ('approve', 'reject'):
            uid  = request.form.get('user_id', type=int)
            user = db.session.get(User, uid) if uid else None
            if user:
                user.student_status = 'approved' if action == 'approve' else 'rejected'
                db.session.commit()
                try:
                    send_student_decision_email(user, action == 'approve')
                except Exception as e:
                    current_app.logger.error(f'Student decision email: {e}')

        return redirect(url_for('auth.admin_verify'))

    # GET
    if not session.get('admin_auth'):
        return render_template('shared/admin_verify.html',
                               authenticated=False, pending=[], error=None)
    pending = User.query.filter_by(student_status='pending')\
                        .order_by(User.student_submitted_at).all()
    return render_template('shared/admin_verify.html',
                           authenticated=True, pending=pending, error=None)


@auth.route('/admin/verify/logout', methods=['GET'])
def admin_verify_logout():
    session.pop('admin_auth', None)
    return redirect(url_for('auth.admin_verify'))


# ══════════════════════════════
#  LOGOUT
# ══════════════════════════════
@auth.route('/logout', methods=['POST'])
@limiter.limit("5 per 15 minutes")
def logout():
    session.clear()
    return jsonify({'redirect': '/'}), 200


# ══════════════════════════════
#  DELETE ACCOUNT
# ══════════════════════════════
@auth.route('/delete-account', methods=['DELETE'])
@limiter.limit("5 per 15 minutes")
def delete_account():
    from werkzeug.security import check_password_hash
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'not logged in'}), 401
    data     = request.get_json(silent=True) or {}
    password = data.get('password', '')
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404
    if not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'wrong password'}), 403
    try:
        db.session.delete(user)
        db.session.commit()
        session.clear()
        return jsonify({'message': 'account deleted'}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete account error: {e}')
        return jsonify({'error': 'deletion failed'}), 500


