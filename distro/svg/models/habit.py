from shared.extensions import db
from datetime import datetime

class Habit(db.Model):
    __tablename__ = 'habits'

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    name        = db.Column(db.String(120), nullable=False)
    track_type  = db.Column(db.String(20), default='manual')
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    is_active   = db.Column(db.Boolean, default=True)

    logs = db.relationship('HabitLog', backref='habit', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id':         self.id,
            'user_id':    self.user_id,
            'name':       self.name,
            'track_type': self.track_type,
            'created_at': self.created_at.isoformat(),
            'is_active':  self.is_active,
        }