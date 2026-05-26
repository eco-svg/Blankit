from shared.extensions import db
from datetime import datetime

class User(db.Model):
    __tablename__ = 'users'

    id              = db.Column(db.Integer, primary_key=True)
    username        = db.Column(db.String(50),  unique=True, nullable=False)
    email           = db.Column(db.String(120), unique=True, nullable=False)
    password_hash   = db.Column(db.String(255), nullable=False)
    distro          = db.Column(db.String(20),  nullable=False, default='Eco-Svg')
    is_verified     = db.Column(db.Boolean, default=False)
    age             = db.Column(db.Integer, nullable=True)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)

    habits  = db.relationship('Habit', backref='user', lazy=True, cascade='all, delete-orphan', passive_deletes=True)
    todos   = db.relationship('Todo',  backref='user', lazy=True, cascade='all, delete-orphan', passive_deletes=True)

    def __repr__(self):
        return f'<User {self.username} [{self.distro}] verified={self.is_verified}>'