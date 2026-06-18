"""
shared/auth/user.py — the User account model (the `users` table).

One row per account, shared by all three distros. The `distro` column records which
product the account belongs to. Passwords are never stored here in plain text — only the
hash (set/checked in auth_route.py).
"""
from shared.extensions import db
from datetime import datetime

class User(db.Model):
    __tablename__ = 'users'

    # ── Identity & login ──
    id              = db.Column(db.Integer, primary_key=True)
    username        = db.Column(db.String(50),  unique=True, nullable=False)
    email           = db.Column(db.String(120), unique=True, nullable=False)
    password_hash   = db.Column(db.String(255), nullable=False)   # bcrypt/werkzeug hash, never the raw password
    distro          = db.Column(db.String(20),  nullable=False, default='Eco-Svg')  # which product this account is on
    is_verified      = db.Column(db.Boolean, default=False)        # email confirmed?
    is_admin         = db.Column(db.Boolean, default=False, nullable=False)  # platform admin (moderation, AMA inbox)

    # ── Moderation: escalating mute (set by admins on confirmed reports) ──
    violation_count  = db.Column(db.Integer, default=0)            # how many times muted → longer next mute
    muted_until      = db.Column(db.DateTime, nullable=True)       # blocked from posting/commenting/DMing until then

    # ── Age (for age-gating / parental-consent rules) ──
    age              = db.Column(db.Integer, nullable=True)
    dob              = db.Column(db.Date, nullable=True)

    # ── Student verification (for student perks; flow partly planned) ──
    student_status       = db.Column(db.String(20), default='none')  # none | pending | approved | rejected
    student_school       = db.Column(db.String(200), nullable=True)
    student_location     = db.Column(db.String(200), nullable=True)
    student_grade        = db.Column(db.String(50),  nullable=True)
    student_id_url       = db.Column(db.String(500), nullable=True)   # object-storage key for the uploaded ID image
    student_submitted_at = db.Column(db.DateTime, nullable=True)

    # ── Bookkeeping ──
    created_at       = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen        = db.Column(db.DateTime, nullable=True)          # drives the online/offline dot

    # Child rows that should be deleted automatically when the user is deleted (cascade).
    habits  = db.relationship('Habit', backref='user', lazy=True, cascade='all, delete-orphan', passive_deletes=True)
    todos   = db.relationship('Todo',  backref='user', lazy=True, cascade='all, delete-orphan', passive_deletes=True)

    def __repr__(self):
        # Short debug string shown in logs / shell, e.g. <User alice [Ocellus] verified=True>
        return f'<User {self.username} [{self.distro}] verified={self.is_verified}>'