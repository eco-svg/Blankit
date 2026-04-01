from flask import Flask
import os
from dotenv import load_dotenv
from routes.pug_routes.extensions import db as pug_db
from routes.pug_routes.pug_route import pug_bp
from flask_migrate import Migrate 

load_dotenv()

pug_uri = os.environ.get('PUG_DB_URI')

if not pug_uri:
    print("CRITICAL ERROR: PUG_DB_URI not found in .env!")
    exit(1) 

app = Flask(__name__)

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

with app.app_context():
    pug_db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)