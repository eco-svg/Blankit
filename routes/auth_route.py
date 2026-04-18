from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from svg_models import db
from svg_models.user import User

auth = Blueprint('auth', __name__, url_prefix='/auth')

# ── distro → home redirect map ──────────────────────────────
DISTRO_REDIRECTS = {
    'ecosvg':   '/home',
    'divyanhu': '/home',
    'thepug':   '/home',
}

# ══════════════════════════════
#  LOGIN
# ══════════════════════════════
@auth.route('/login', methods=['POST'])
def login():
    data       = request.get_json()
    identifier = data.get('identifier', '').strip()
    method     = data.get('method', 'email')
    password   = data.get('password', '')
    distro     = data.get('distro', 'ecosvg')
    remember   = data.get('remember', False)

    # Find user by email or username
    if method == 'email':
        user = User.query.filter_by(email=identifier).first()
    else:
        user = User.query.filter_by(username=identifier).first()

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'invalid credentials'}), 401

    session.permanent       = remember
    session['user_id']      = user.id
    session['username']     = user.username
    session['distro']       = distro

    return jsonify({'redirect': DISTRO_REDIRECTS.get(distro, '/home')}), 200


# ══════════════════════════════
#  REGISTER
# ══════════════════════════════
@auth.route('/register', methods=['POST'])
def register():
    data     = request.get_json()
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip()
    password = data.get('password', '')
    distro   = data.get('distro', 'ecosvg')

    # Check duplicates
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'username already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'email already registered'}), 409

    new_user = User(
        username      = username,
        email         = email,
        password_hash = generate_password_hash(password),
    )

    db.session.add(new_user)
    db.session.commit()

    return jsonify({'message': 'account created'}), 200


# ══════════════════════════════
#  FORGOT PASSWORD
# ══════════════════════════════
@auth.route('/forgot-password', methods=['POST'])
def forgot_password():
    data  = request.get_json()
    email = data.get('email', '').strip()

    user = User.query.filter_by(email=email).first()
    # Always return 200 so we don't leak which emails exist
    # TODO: send real reset email when user is found
    return jsonify({'message': 'reset link sent if email exists'}), 200


# ══════════════════════════════
#  LOGOUT
# ══════════════════════════════
@auth.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'redirect': '/'}), 200

