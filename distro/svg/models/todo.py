from shared.extensions import db
from datetime import datetime, date

class Todo(db.Model):
    __tablename__ = 'todos'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    text       = db.Column(db.String(300), nullable=False)
    date       = db.Column(db.Date, nullable=False, default=date.today)
    done       = db.Column(db.Boolean, default=False)
    priority   = db.Column(db.String(10), default='medium')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':       self.id,
            'user_id':  self.user_id,
            'text':     self.text,
            'date':     self.date.isoformat(),
            'done':     self.done,
            'priority': self.priority,
        }