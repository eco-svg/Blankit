# ═══════════════════════════════════════════
# routes/auth_route.py — Blankit shared auth
# Handles: login, register, forgot password,
#          logout, session management
# ═══════════════════════════════════════════

from flask import Blueprint, request, jsonify, session, redirect, url_for, render_template

from svg_models import db
from svg_models.user import User
from svg_models.reset_token import ResetToken
from functools import wraps
import bcrypt
import secrets
from datetime import datetime, timedelta

auth = Blueprint('auth', __name__, url_prefix='/auth')

# ── DISTRO → HOME URL MAP ──────────────────
DISTRO_HOME = {
    'ecosvg':   '/svg/home',
    'divyanhu': '/divyanhu/home',
    'thepug':   '/pug/home',
}

# ══════════════════════════════
# DECORATOR — login required
# ══════════════════════════════

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'not authenticated'}), 401
        return f(*args, **kwargs)
    return decorated

# ══════════════════════════════
# REGISTER
# ══════════════════════════════

@auth.route('/register', methods=['POST'])
def register():
    data     = request.get_json()
    username = data.get('username', '').strip().lower()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    # ── validation ────────────────────────
    if not username or len(username) < 3:
        return jsonify({'error': 'username must be at least 3 characters'}), 400

    if not email or '@' not in email:
        return jsonify({'error': 'invalid email address'}), 400

    if not password or len(password) < 8:
        return jsonify({'error': 'password must be at least 8 characters'}), 400

    # ── check duplicates ──────────────────
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'username already taken'}), 409

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'email already registered'}), 409

    # ── hash password ─────────────────────
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    # ── create user ───────────────────────
    user = User(
        username       = username,
        email          = email,
        password_hash  = hashed,
        created_at     = datetime.utcnow(),
    )
    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'account created successfully'}), 201

# ══════════════════════════════
# LOGIN
# ══════════════════════════════

@auth.route('/login', methods=['POST'])
def login():
    data       = request.get_json()
    identifier = data.get('identifier', '').strip().lower()
    method     = data.get('method', 'email')      # 'email' or 'username'
    password   = data.get('password', '')
    remember   = data.get('remember', False)
    distro     = data.get('distro', 'ecosvg')

    # ── validation ────────────────────────
    if not identifier or not password:
        return jsonify({'error': 'all fields are required'}), 400

    # ── find user ─────────────────────────
    if method == 'email':
        user = User.query.filter_by(email=identifier).first()
    else:
        user = User.query.filter_by(username=identifier).first()

    if not user:
        return jsonify({'error': 'invalid credentials'}), 401

    # ── verify password ───────────────────
    if not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
        return jsonify({'error': 'invalid credentials'}), 401

    # ── set session ───────────────────────
    session.permanent = remember
    session['user_id']  = user.id
    session['username'] = user.username
    session['distro']   = distro

    # ── redirect to correct distro home ───
    redirect_url = DISTRO_HOME.get(distro, '/svg/home')

    return jsonify({
        'message':  'logged in successfully',
        'redirect': redirect_url,
        'user': {
            'id':       user.id,
            'username': user.username,
            'email':    user.email,
        }
    }), 200

# ══════════════════════════════
# LOGOUT
# ══════════════════════════════

@auth.route('/logout', methods=['POST'])
@login_required
def logout():
    session.clear()
    return jsonify({'message': 'logged out'}), 200

# ══════════════════════════════
# FORGOT PASSWORD
# ══════════════════════════════

@auth.route('/forgot-password', methods=['POST'])
def forgot_password():
    data  = request.get_json()
    email = data.get('email', '').strip().lower()

    if not email or '@' not in email:
        return jsonify({'error': 'invalid email address'}), 400

    user = User.query.filter_by(email=email).first()

    # always return success even if user not found (security)
    if not user:
        return jsonify({'message': 'if that email exists, a reset link was sent'}), 200

    # ── generate token ────────────────────
    token     = secrets.token_urlsafe(32)
    expires   = datetime.utcnow() + timedelta(hours=1)

    # delete any existing tokens for this user
    ResetToken.query.filter_by(user_id=user.id).delete()

    reset = ResetToken(
        user_id    = user.id,
        token      = token,
        expires_at = expires,
    )
    db.session.add(reset)
    db.session.commit()

    # ── send email ────────────────────────
    # TODO: plug in Flask-Mail or SendGrid here
    # For now just print the reset link to console (dev mode)
    reset_link = f"http://localhost:5000/auth/reset-password/{token}"
    print(f"\n[DEV] Password reset link for {email}:\n{reset_link}\n")

    return jsonify({'message': 'if that email exists, a reset link was sent'}), 200

# ══════════════════════════════
# RESET PASSWORD
# ══════════════════════════════

@auth.route('/reset-password/<token>', methods=['GET'])
def reset_password_page(token):
    reset = ResetToken.query.filter_by(token=token).first()

    if not reset or reset.expires_at < datetime.utcnow():
        return 'Invalid or expired reset link.', 400

    # serve reset password page (you can make a proper template for this)
    return f'''
    <!DOCTYPE html>
    <html>
    <head><title>Reset Password</title></head>
    <body style="font-family:monospace;background:#0c0f09;color:#e8f0d8;
                 display:flex;align-items:center;justify-content:center;height:100vh;">
      <form method="POST" action="/auth/reset-password/{token}"
            style="display:flex;flex-direction:column;gap:1rem;width:320px;">
        <h2 style="color:#639922">reset password</h2>
        <input name="password" type="password" placeholder="new password"
               style="padding:.6rem;background:#131810;border:1px solid #2a3520;
                      border-radius:8px;color:#e8f0d8;font-size:.9rem"/>
        <button type="submit"
                style="padding:.7rem;background:#639922;color:#0c0f09;
                       border:none;border-radius:8px;font-weight:700;cursor:pointer">
          set new password
        </button>
      </form>
    </body>
    </html>
    ''', 200

@auth.route('/reset-password/<token>', methods=['POST'])
def reset_password_submit(token):
    reset = ResetToken.query.filter_by(token=token).first()

    if not reset or reset.expires_at < datetime.utcnow():
        return jsonify({'error': 'invalid or expired token'}), 400

    new_password = request.form.get('password', '')

    if not new_password or len(new_password) < 8:
        return 'Password must be at least 8 characters.', 400

    # ── update password ───────────────────
    user = User.query.get(reset.user_id)
    user.password_hash = bcrypt.hashpw(
        new_password.encode(), bcrypt.gensalt()
    ).decode()

    db.session.delete(reset)
    db.session.commit()

    return redirect('/')
# ── serve login page ──────────────────────
@auth.route('/')
@auth.route('/login')
def login_page():
    return render_template('login.html')

# ══════════════════════════════
# CURRENT USER (helper API)
# ══════════════════════════════

@auth.route('/me', methods=['GET'])
@login_required
def me():
    user = User.query.get(session['user_id'])
    if not user:
        session.clear()
        return jsonify({'error': 'user not found'}), 404

    return jsonify({
        'id':       user.id,
        'username': user.username,
        'email':    user.email,
        'distro':   session.get('distro', 'ecosvg'),
    }), 200




