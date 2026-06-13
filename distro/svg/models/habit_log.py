"""
svg model: HabitLog — one row per (habit, date) recording whether it was done that day.
Unique per habit+date so a day can only be logged once.
"""
from shared.extensions import db
from datetime import datetime, date

class HabitLog(db.Model):
    __tablename__ = 'habit_logs'

    id         = db.Column(db.Integer, primary_key=True)
    habit_id   = db.Column(db.Integer, db.ForeignKey('habits.id', ondelete='CASCADE'), nullable=False)
    date       = db.Column(db.Date, nullable=False, default=date.today)
    done       = db.Column(db.Boolean, default=False)
    logged_at  = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('habit_id', 'date', name='unique_habit_date'),
    )

    def to_dict(self):
        return {
            'id':       self.id,
            'habit_id': self.habit_id,
            'date':     self.date.isoformat(),
            'done':     self.done,
        }