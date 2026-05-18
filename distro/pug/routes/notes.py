from datetime import datetime
from distro.pug.extensions import encrypt, decrypt
from shared.models import db
from shared.auth.user import User  # noqa: F401  (re-exported for callers)


class Note(db.Model):
    __tablename__ = 'notes'

    id             = db.Column(db.Integer, primary_key=True)
    user_id        = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, server_default='1')
    _title         = db.Column('title', db.String(500), default='')
    _body          = db.Column('body', db.Text, default='')
    mood           = db.Column(db.String(50), default='')
    start_datetime = db.Column(db.DateTime, nullable=True)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at     = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_deleted     = db.Column(db.Boolean, default=False)
    entry_type     = db.Column(db.String(50), default='note')
    is_finished    = db.Column(db.Boolean, default=False)

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
            'id':             self.id,
            'title':          self.title,
            'body':           self.body,
            'entry_type':     self.entry_type,
            'is_finished':    self.is_finished,
            'start_datetime': self.start_datetime.isoformat() if self.start_datetime else None,
            'created_at':     self.created_at.isoformat()     if self.created_at     else None,
            'updated_at':     self.updated_at.isoformat()     if self.updated_at     else None,
        }