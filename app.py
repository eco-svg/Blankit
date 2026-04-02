from flask import Flask, render_template, request, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash
import os
from dotenv import load_dotenv
from routes.pug_routes.extensions import db as pug_db
from routes.pug_routes.pug_route import pug_bp
from routes.pug_routes.notes import User  # IMPORT YOUR NEW USER MODEL
from flask_migrate import Migrate 

load_dotenv()

pug_uri = os.environ.get('PUG_DB_URI')

if not pug_uri:
    print("CRITICAL ERROR: PUG_DB_URI not found in .env!")
    exit(1) 

app = Flask(__name__, template_folder='templates') # Make sure Flask knows where templates are globally

# --- REQUIRED FOR LOGIN SESSIONS ---
app.secret_key = os.environ.get('SECRET_KEY', 'default_dev_key_change_in_production')

# The "Landlord" memory database to keep Flask happy
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Your private Silo
app.config['SQLALCHEMY_BINDS'] = {
    'pug_db': pug_uri,
}

pug_db.init_app(app)
migrate = Migrate(app, pug_db) 

app.register_blueprint(pug_bp)

# ==========================================
# --- AUTHENTICATION GATEWAY ---
# ==========================================
@app.route('/')
def index():
    if 'user_id' in session:
        # If logged in, send directly to their chosen route
        route = session.get('route', 'pug')
        if route == 'pug':
            return redirect(url_for('pug.home'))
        # Add future routes here
    return render_template('index.html')

@app.route('/auth', methods=['POST'])
def auth():
    username = request.form.get('username')
    password = request.form.get('password')
    route_choice = request.form.get('requested_route', 'pug')

    user = User.query.filter_by(username=username).first()

    if user:
        if check_password_hash(user.password_hash, password):
            session['user_id'] = user.id
            session['username'] = user.username
            session['route'] = user.chosen_route
            return redirect(url_for(f"{user.chosen_route}.home")) 
        else:
            return "Incorrect password. Hit Back and try again.", 401
    else:
        # Auto-create new user
        hashed_pw = generate_password_hash(password)
        new_user = User(username=username, password_hash=hashed_pw, chosen_route=route_choice)
        pug_db.session.add(new_user)
        pug_db.session.commit()
        
        session['user_id'] = new_user.id
        session['username'] = new_user.username
        session['route'] = new_user.chosen_route
        return redirect(url_for(f"{new_user.chosen_route}.home"))

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# ==========================================

with app.app_context():
    pug_db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)