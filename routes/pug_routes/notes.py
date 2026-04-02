from datetime import datetime
from .extensions import db, encrypt, decrypt

# --- NEW: THE USER MODEL ---
class User(db.Model):
    __bind_key__ = 'pug_db'
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    chosen_route = db.Column(db.String(50), nullable=False, default='pug') 
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# --- EXISTING: THE NOTE/GOAL MODEL ---
class Note(db.Model):
    __bind_key__ = 'pug_db'
    __tablename__ = 'notes'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, server_default='1')
    _title = db.Column('title', db.String(500), default='')    _body = db.Column('body', db.Text, default='')
    mood = db.Column(db.String(50), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_deleted = db.Column(db.Boolean, default=False)
    entry_type = db.Column(db.String(50), default='note') 
    is_finished = db.Column(db.Boolean, default=False)    
    
    @property
    def title(self):
        return decrypt(self._title) if self._title else ''

    @title.setter
    def title(self, value):
        self._title = encrypt(value) if value else ''

    @property
    def body(self):
        return decrypt(self._body) if self._body else ''

    @body.setter
    def body(self, value):
        self._body = encrypt(value) if value else ''

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'body': self.body,
            'entry_type': self.entry_type,     
            'is_finished': self.is_finished,   
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }