from shared.models import db
from datetime import datetime, timedelta
import random
import secrets

class VerifyToken(db.Model):
    __tablename__ = 'verify_tokens'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    otp        = db.Column(db.String(6),  nullable=False)
    token      = db.Column(db.String(64), unique=True, nullable=False)  # kept for compatibility
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used       = db.Column(db.Boolean, default=False)

    def __init__(self, user_id):
        self.user_id    = user_id
        self.otp        = str(random.randint(100000, 999999))
        self.token      = secrets.token_urlsafe(32)
        self.expires_at = datetime.utcnow() + timedelta(minutes=10)

    def is_valid(self):
        return not self.used and datetime.utcnow() < self.expires_at


class ResetToken(db.Model):
    __tablename__ = 'reset_tokens'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    token      = db.Column(db.String(64), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used       = db.Column(db.Boolean, default=False)

    def __init__(self, user_id):
        self.user_id    = user_id
        self.token      = secrets.token_urlsafe(32)
        self.expires_at = datetime.utcnow() + timedelta(hours=1)

    def is_valid(self):
        return not self.used and datetime.utcnow() < self.expires_at