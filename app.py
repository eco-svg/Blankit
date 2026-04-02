from flask import Flask, render_template, request, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash
import os
from dotenv import load_dotenv
from routes.pug_routes.extensions import db as pug_db
from routes.pug_routes.pug_route import pug_bp
from routes.pug_routes.notes import User
from flask_migrate import Migrate 

load_dotenv()

pug_uri = os.environ.get('PUG_DB_URI')

if not pug_uri:
    print("CRITICAL ERROR: PUG_DB_URI not found in .env!")
    exit(1) 

app = Flask(__name__, template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'default_dev_key_change_in_production')

app.config['SQLALCHEMY_DATABASE_URI'] = pug_uri 
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

pug_db.init_app(app)
migrate = Migrate(app, pug_db) 
app.register_blueprint(pug_bp)

# ==========================================
# --- AUTHENTICATION GATEWAY ---
# ==========================================

@app.route('/')
def index():
    # Only redirect if they are logged in AND it's a 'pug' user
    if 'user_id' in session:
        route = session.get('route')
        if route == 'pug':
            return redirect(url_for('pug.home'))
    return render_template('index.html')

@app.route('/auth', methods=['POST'])
def auth():
    username = request.form.get('username')
    password = request.form.get('password')
    phone = request.form.get('phone') # Capture the phone
    route_choice = request.form.get('requested_route', 'pug')

    # --- HARD LOCKDOWN ---
    # Block registration or login for anything except Pug route
    if route_choice != 'pug':
        return """
        <body style="background:#0a0a0c; color:#f0f0f0; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; text-align:center;">
            <h2 style="font-size:3rem; margin-bottom:10px;">403</h2>
            <h2 style="color:#cc6666;">ACCESS DENIED</h2>
            <p style="color:#888899; max-width:400px; line-height:1.6;">Operational Route <b>{0}</b> is currently encrypted and locked for maintenance. Please check the devlogs for the next phase release.</p>
            <a href="/" style="color:#e8a020; text-decoration:none; margin-top:30px; border:1px solid #e8a020; padding:12px 30px; border-radius:8px; font-weight:bold; transition: 0.3s;">Return to Gateway</a>
        </body>
        """.format(route_choice.upper()), 403

    user = User.query.filter_by(username=username).first()

    if user:
        # Existing User: Login
        if check_password_hash(user.password_hash, password):
            session['user_id'] = user.id
            session['username'] = user.username
            session['route'] = user.chosen_route
            return redirect(url_for('pug.home'))
        else:
            return """
            <body style="background:#0a0a0c; color:#f0f0f0; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh;">
                <h2 style="color:#cc6666; margin-bottom:10px;">AUTHENTICATION FAILED</h2>
                <p style="color:#888899;">Incorrect Passcode for Operator <b>{0}</b>.</p>
                <a href="javascript:history.back()" style="color:#e8a020; text-decoration:none; margin-top:20px; border:1px solid #e8a020; padding:10px 25px; border-radius:5px;">Retry Initialization</a>
            </body>
            """.format(username), 401
    else:
        # New User: Signup
        hashed_pw = generate_password_hash(password)
        new_user = User(
            username=username, 
            password_hash=hashed_pw, 
            phone=phone, # Save phone
            chosen_route=route_choice
        )
        pug_db.session.add(new_user)
        pug_db.session.commit()
        
        session['user_id'] = new_user.id
        session['username'] = new_user.username
        session['route'] = new_user.chosen_route
        return redirect(url_for('pug.home'))
        
@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

with app.app_context():
    pug_db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)