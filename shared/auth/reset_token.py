"""
shared/auth/reset_token.py — short-lived security tokens for email flows.

  • VerifyToken — the 6-digit code emailed to confirm a new account's email address.
  • ResetToken  — the random link token emailed to reset a forgotten password.

Both expire and are single-use; VerifyToken also caps wrong-guess attempts.
"""
from shared.extensions import db
from datetime import datetime, timedelta
import secrets

class VerifyToken(db.Model):
    """A one-time 6-digit email-verification code (valid 10 min, max 5 attempts)."""
    __tablename__ = 'verify_tokens'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    otp        = db.Column(db.String(6),  nullable=False)
    token      = db.Column(db.String(64), unique=True, nullable=False)  # kept for compatibility
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used       = db.Column(db.Boolean, default=False)   # flipped True once the code is accepted
    attempts   = db.Column(db.Integer, default=0)        # wrong guesses so far (anti-brute-force)

    MAX_ATTEMPTS = 5  # lock the code after this many wrong guesses

    def __init__(self, user_id):
        # Generate a fresh 6-digit code (100000–999999) and a random URL token on creation.
        self.user_id    = user_id
        self.otp        = str(secrets.randbelow(900000) + 100000)
        self.token      = secrets.token_urlsafe(32)
        self.expires_at = datetime.utcnow() + timedelta(minutes=10)
        self.attempts   = 0

    def is_valid(self):
        """True only if the code is unused, unexpired, and under the attempt cap."""
        return (not self.used
                and datetime.utcnow() < self.expires_at
                and (self.attempts or 0) < self.MAX_ATTEMPTS)


class ResetToken(db.Model):
    """A one-time password-reset link token (valid 1 hour)."""
    __tablename__ = 'reset_tokens'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    token      = db.Column(db.String(64), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used       = db.Column(db.Boolean, default=False)

    def __init__(self, user_id):
        self.user_id    = user_id
        self.token      = secrets.token_urlsafe(32)         # random, unguessable link token
        self.expires_at = datetime.utcnow() + timedelta(hours=1)

    def is_valid(self):
        """True only if the reset link is unused and unexpired."""
        return not self.used and datetime.utcnow() < self.expires_at