# svg_models/reset_token.py

from svg_models import db
from datetime import datetime

class ResetToken(db.Model):
    __tablename__ = 'reset_tokens'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    token      = db.Column(db.String(100), unique=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<ResetToken user_id={self.user_id}>'