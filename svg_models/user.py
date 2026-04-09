# svg_models/user.py

from svg_models import db
from datetime import datetime

class User(db.Model):
    __tablename__ = 'users'

    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(50), unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    # relationships
    habits  = db.relationship('Habit', backref='user', lazy=True)
    todos   = db.relationship('Todo',  backref='user', lazy=True)

    def __repr__(self):
        return f'<User {self.username}>'