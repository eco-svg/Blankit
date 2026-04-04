# app.py
# Main Flask application entry point.
# Handles authentication and wires all blueprints together.

import os
import phonenumbers  # pip install phonenumbers
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
from flask_migrate import Migrate
from routes.pug_routes.extensions import db as pug_db
from routes.pug_routes.pug_route import pug_bp
from routes.pug_routes.notes import User

load_dotenv()

pug_uri = os.environ.get('PUG_DB_URI')
if not pug_uri:
    print("CRITICAL: PUG_DB_URI not set in .env")
    exit(1)

app = Flask(__name__, template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'change_this_in_production')
app.config['SQLALCHEMY_DATABASE_URI'] = pug_uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

pug_db.init_app(app)
migrate = Migrate(app, pug_db)
app.register_blueprint(pug_bp)


# ─────────────────────────────────────────
# PHONE VALIDATION
# ─────────────────────────────────────────

def parse_phone(raw: str):
    """
    Parses and validates an international phone number.
    Returns the E.164 formatted string (e.g. +911234567890) if valid.
    Returns None if invalid.

    phonenumbers.parse(number, None) means:
      - None = no default region assumed
      - So the user MUST include country code e.g. +91, +1, +44
      - This works for every country in the world
    """
    raw = raw.strip()
    try:
        parsed = phonenumbers.parse(raw, None)
        if phonenumbers.is_valid_number(parsed):
            # format_number returns the standardized international format
            return phonenumbers.format_number(
                parsed,
                phonenumbers.PhoneNumberFormat.E164
            )
        return None
    except phonenumbers.NumberParseException:
        return None


def error_page(title, message, back_url="/"):
    """
    Returns a minimal styled error page.
    Used instead of flash messages for simplicity.
    """
    return f"""
    <body style="background:#0a0a0c;color:#f0f0f0;font-family:sans-serif;
                 display:flex;flex-direction:column;align-items:center;
                 justify-content:center;height:100vh;text-align:center;gap:16px;">
        <h2 style="color:#cc6666;font-size:1.6rem;">{title}</h2>
        <p style="color:#888899;max-width:400px;line-height:1.6;">{message}</p>
        <a href="{back_url}" style="color:#e8a020;text-decoration:none;
           border:1px solid #e8a020;padding:10px 28px;border-radius:8px;">
           Go Back
        </a>
    </body>
    """


# ─────────────────────────────────────────
# PAGE ROUTES
# ─────────────────────────────────────────

@app.route('/')
def index():
    if 'user_id' in session and session.get('route') == 'pug':
        return redirect(url_for('pug.home'))
    return render_template('index.html')


@app.route('/auth', methods=['POST'])
def auth():
    username     = request.form.get('username', '').strip()
    password     = request.form.get('password', '').strip()
    raw_phone    = request.form.get('phone', '').strip()
    route_choice = request.form.get('requested_route', 'pug').strip()

    # ── Lock non-pug routes ──
    if route_choice != 'pug':
        return error_page(
            "ACCESS DENIED",
            f"Route <b>{route_choice.upper()}</b> is locked. Check devlogs for next release."
        ), 403

    # ── Validate phone ──
    # parse_phone returns None if invalid or no country code provided
    phone_e164 = parse_phone(raw_phone)
    if not phone_e164:
        return error_page(
            "INVALID PHONE NUMBER",
            "Enter your number in international format with country code. "
            "Examples: +91 98765 43210 (India), +1 555 123 4567 (USA), +44 7700 900123 (UK). "
            "Every country is supported as long as the code is included."
        ), 400

    # ── Check if this phone is already registered to a DIFFERENT username ──
    phone_owner = User.query.filter_by(phone=phone_e164).first()

    existing_user = User.query.filter_by(username=username).first()

    if existing_user:
        # ── LOGIN FLOW ──

        # Verify password
        if not check_password_hash(existing_user.password_hash, password):
            return error_page(
                "WRONG PASSCODE",
                f"Incorrect passcode for operator <b>{username}</b>."
            ), 401

        # Verify phone matches this account
        # This prevents someone from logging in with another person's phone
        if existing_user.phone != phone_e164:
            return error_page(
                "PHONE MISMATCH",
                "That phone number doesn't match this account. "
                "Each account is permanently linked to one phone number."
            ), 403

        # All good — log them in
        session['user_id']  = existing_user.id
        session['username'] = existing_user.username
        session['route']    = existing_user.chosen_route
        return redirect(url_for('pug.home'))

    else:
        # ── SIGNUP FLOW ──

        # Block if phone is already linked to another account
        # Each phone number can only ever create ONE account
        if phone_owner:
            return error_page(
                "PHONE ALREADY REGISTERED",
                "This phone number is already linked to another account. "
                "Each phone number can only be used for one account. "
                "This choice is permanent and cannot be changed."
            ), 409
            # 409 = Conflict

        # Create new user
        new_user = User(
            username      = username,
            password_hash = generate_password_hash(password),
            phone         = phone_e164,   # stored in E.164 format
            chosen_route  = route_choice
            # chosen_route is locked at registration — can never change
        )
        pug_db.session.add(new_user)
        pug_db.session.commit()

        session['user_id']  = new_user.id
        session['username'] = new_user.username
        session['route']    = new_user.chosen_route
        return redirect(url_for('pug.home'))


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


# ─────────────────────────────────────────
# INIT DB
# ─────────────────────────────────────────

with app.app_context():
    pug_db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)