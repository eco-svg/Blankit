from shared.extensions import db
from datetime import datetime

# ── Master badge definitions (seeded once) ──────────────────────────
BADGE_DEFINITIONS = [
    { 'key': 'on_fire',        'name': 'On Fire',          'icon': '🔥', 'desc': '7 day streak',                      'condition': 'streak_7'    },
    { 'key': 'iron',           'name': 'Iron Discipline',  'icon': '🏆', 'desc': 'All habits done 30 days straight',  'condition': 'streak_30'   },
    { 'key': 'early_riser',    'name': 'Early Riser',      'icon': '⚡', 'desc': 'Morning habits 20 days in a row',   'condition': 'streak_20'   },
    { 'key': 'first_seed',     'name': 'First Seed',       'icon': '🌱', 'desc': 'First 7 day streak ever',           'condition': 'first_week'  },
    { 'key': 'hydrated',       'name': 'Hydrated',         'icon': '💧', 'desc': 'Water habit 14 days',               'condition': 'habit_14'    },
    { 'key': 'bookworm',       'name': 'Bookworm',         'icon': '📚', 'desc': 'Read 10 days straight',             'condition': 'habit_10'    },
    { 'key': 'centered',       'name': 'Centered',         'icon': '🧘', 'desc': 'Meditated 5 days',                  'condition': 'habit_5'     },
    { 'key': 'in_motion',      'name': 'In Motion',        'icon': '🏃', 'desc': 'Exercise streak 10 days',           'condition': 'habit_10'    },
    { 'key': 'dawn_patrol',    'name': 'Dawn Patrol',      'icon': '🌅', 'desc': 'Up before 6am, 5 days',             'condition': 'habit_5'     },
    { 'key': 'warrior',        'name': 'Warrior',          'icon': '⚔️', 'desc': '50 day streak',                     'condition': 'streak_50'   },
    { 'key': 'diamond',        'name': 'Diamond',          'icon': '💎', 'desc': '100 day streak',                    'condition': 'streak_100'  },
    { 'key': 'sharpshooter',   'name': 'Sharpshooter',    'icon': '🎯', 'desc': '100% completion for a week',        'condition': 'perfect_week'},
    { 'key': 'night_owl',      'name': 'Night Owl',        'icon': '🌙', 'desc': 'Log habits after 10pm, 7 days',    'condition': 'night_7'     },
]

class Badge(db.Model):
    __tablename__ = 'badges'

    id        = db.Column(db.Integer, primary_key=True)
    key       = db.Column(db.String(50), unique=True, nullable=False)
    name      = db.Column(db.String(100), nullable=False)
    icon      = db.Column(db.String(10), nullable=False)
    desc      = db.Column(db.String(200))
    condition = db.Column(db.String(50))  # used by badge_service

    earned    = db.relationship('UserBadge', backref='badge', lazy=True)

    def to_dict(self, earned=False, earned_at=None, rank=None):
        return {
            'id':        self.id,
            'key':       self.key,
            'name':      self.name,
            'icon':      self.icon,
            'desc':      self.desc,
            'earned':    earned,
            'earned_at': earned_at.isoformat() if earned_at else None,
            'rank':      rank,
        }


class UserBadge(db.Model):
    __tablename__ = 'user_badges'

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    badge_id    = db.Column(db.Integer, db.ForeignKey('badges.id'), nullable=False)
    earned_at   = db.Column(db.DateTime, default=datetime.utcnow)
    podium_rank = db.Column(db.Integer, nullable=True)  # 1/2/3 or null

    def to_dict(self):
        return {
            'badge_id':    self.badge_id,
            'earned_at':   self.earned_at.isoformat(),
            'podium_rank': self.podium_rank,
        }