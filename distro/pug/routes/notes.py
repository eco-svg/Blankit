"""
distro/pug/routes/notes.py — the pug distro's database models (plus Eye-rate helpers).

Tables defined here:
  • Note        — a single, heavily-reused row type. The `entry_type` column decides what
                  it is: a personal note, goal, dream, OR a community post / comment /
                  reaction / DM. Title and body are stored ENCRYPTED (see .title/.body).
  • Wallet / WalletTx / EyeRate — the "Eyes" in-app currency: balances, transactions, FX.
  • AmaMessage  — "Ask Anything" messages between a user and the admin.
  • PostReport / UserBlock / UserReport — moderation: post reports, user blocks, DM reports.

`User` is imported and re-exported so other modules can do `from notes import User`.
"""
import json
import urllib.request
import warnings
from datetime import datetime
from distro.pug.extensions import encrypt, decrypt
from shared.extensions import db
from shared.auth.user import User  # noqa: F401  (re-exported for callers)


class Note(db.Model):
    # One flexible row type for many features — `entry_type` distinguishes them
    # (note / goal / dream / community_post / post_comment / post_react / dm / ...).
    __tablename__ = 'notes'

    id             = db.Column(db.Integer, primary_key=True)
    user_id        = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, server_default='1')
    _title         = db.Column('title', db.String(500), default='')
    _body          = db.Column('body', db.Text, default='')
    mood           = db.Column(db.String(50), default='')
    start_datetime = db.Column(db.DateTime, nullable=True)
    end_datetime   = db.Column(db.DateTime, nullable=True)   # calendar event spans (end day/time)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at     = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_deleted     = db.Column(db.Boolean, default=False)
    entry_type     = db.Column(db.String(50), default='note')
    is_finished    = db.Column(db.Boolean, default=False)
    report_count   = db.Column(db.Integer, default=0)      # community moderation: # of distinct reports
    is_hidden      = db.Column(db.Boolean, default=False)  # auto-quarantined or admin-removed from the feed

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
            'end_datetime':   self.end_datetime.isoformat()   if self.end_datetime   else None,
            'created_at':     self.created_at.isoformat()     if self.created_at     else None,
            'updated_at':     self.updated_at.isoformat()     if self.updated_at     else None,
        }


class Wallet(db.Model):
    __tablename__ = 'wallets'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), unique=True, nullable=False)
    balance    = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WalletTx(db.Model):
    __tablename__ = 'wallet_transactions'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    tx_type    = db.Column(db.String(30), nullable=False)  # topup_request|topup_paid|spend|earn|sellback_request|sellback_paid|payout_request|payout_sent
    amount     = db.Column(db.Integer, nullable=False)     # credits; positive = added, negative = deducted
    ref_id     = db.Column(db.String(100))                 # currency code (INR/USD…) or in-app order/post id
    ext_ref    = db.Column(db.String(64))                  # external payment ref: Razorpay order_id (on the request) / payment_id (on the paid tx)
    note       = db.Column(db.String(300))
    status     = db.Column(db.String(20), default='pending')  # pending|completed|rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class EyeRate(db.Model):
    __tablename__ = 'eye_rates'
    currency   = db.Column(db.String(10), primary_key=True)
    buy_rate   = db.Column(db.Numeric(18, 8), nullable=False)  # local currency charged per Eye
    sell_rate  = db.Column(db.Numeric(18, 8), nullable=False)  # local currency paid per Eye on sell-back
    min_topup  = db.Column(db.Integer, default=20, nullable=False)
    symbol     = db.Column(db.String(10), default='')
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)


class AmaMessage(db.Model):
    __tablename__ = 'ama_messages'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    body       = db.Column(db.Text, nullable=False)
    is_admin   = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class PostReport(db.Model):
    """A user's report against a community post. One row per (post, reporter)."""
    __tablename__ = 'post_reports'
    id          = db.Column(db.Integer, primary_key=True)
    post_id     = db.Column(db.Integer, db.ForeignKey('notes.id', ondelete='CASCADE'), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    reason      = db.Column(db.String(300), default='')
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('post_id', 'reporter_id', name='uq_post_reporter'),)


class UserBlock(db.Model):
    """blocker_id has blocked blocked_id — hides their posts and prevents DMs both ways."""
    __tablename__ = 'user_blocks'
    id         = db.Column(db.Integer, primary_key=True)
    blocker_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    blocked_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('blocker_id', 'blocked_id', name='uq_blocker_blocked'),)


class UserReport(db.Model):
    """A report against a user — used for DM/conversation reports (DMs are unmoderated;
    this is the notice-and-action record an admin reviews)."""
    __tablename__ = 'user_reports'
    id          = db.Column(db.Integer, primary_key=True)
    reporter_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    reported_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    context     = db.Column(db.String(20), default='dm')   # where the report came from
    reason      = db.Column(db.String(300), default='')
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)


class SharedMedia(db.Model):
    """Tracks each shared upload's context so DM attachments stay private.

    context='post' → public (any logged-in user, like before). context='dm' → only the
    uploader and `peer_id` may fetch it. Legacy uploads have no row → treated as public.
    """
    __tablename__ = 'shared_media'
    id          = db.Column(db.Integer, primary_key=True)
    object_name = db.Column(db.String(300), unique=True, nullable=False)   # the 'shared/<uuid>.<ext>' key
    uploader_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    context     = db.Column(db.String(10), default='post')                 # 'post' | 'dm'
    peer_id     = db.Column(db.Integer, nullable=True)                      # the other DM participant
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)


class SiteVisit(db.Model):
    """Privacy-light daily page-view counter (one row per day). No personal data —
    just a tally of HTML page loads. Admin/owner traffic is excluded at record time."""
    __tablename__ = 'site_visits'
    day   = db.Column(db.Date, primary_key=True)
    views = db.Column(db.Integer, nullable=False, default=0)


class SiteVisitor(db.Model):
    """Daily UNIQUE-visitor dedupe set. Stores only a one-way hash of (day + secret +
    IP + user-agent) — the IP itself is never persisted, and the hash rotates daily,
    so it can't be reversed to identify anyone (Plausible-style). Uniques for a day =
    count of rows for that day."""
    __tablename__ = 'site_visitors'
    day   = db.Column(db.Date, primary_key=True)
    vhash = db.Column(db.String(64), primary_key=True)


# ── Rate constants ────────────────────────────────────────────────────────────

_EYE_USD  = 0.01   # 1 Eye = $0.01 (base)
_SPREAD   = 0.10   # 10% spread between buy and sell rates

# Minimum Eyes required to top up, tiered by economic region
_MIN_TOPUP = {
    # South Asia — min 20
    'INR': 20, 'PKR': 20, 'BDT': 20, 'NPR': 20, 'LKR': 20, 'MMK': 20, 'AFN': 20,
    # Mid-tier — min 50
    'CNY': 50, 'IDR': 50, 'BRL': 50, 'MXN': 50, 'PHP': 50, 'MYR': 50,
    'THB': 50, 'VND': 50, 'NGN': 50, 'KES': 50, 'ZAR': 50, 'EGP': 50,
    'GHS': 50, 'TZS': 50, 'UAH': 50, 'KZT': 50, 'ARS': 50, 'COP': 50,
    'PEN': 50, 'TRY': 50, 'RUB': 50,
    # High income: 100 (default, see _DEFAULT_MIN)
}
_DEFAULT_MIN = 100

_SYMBOLS = {
    'USD': '$',    'EUR': '€',    'GBP': '£',    'INR': '₹',    'JPY': '¥',
    'CNY': '¥',    'AUD': 'A$',   'CAD': 'C$',   'CHF': 'Fr',   'SGD': 'S$',
    'HKD': 'HK$',  'KRW': '₩',   'SEK': 'kr',   'NOK': 'kr',   'DKK': 'kr',
    'NZD': 'NZ$',  'PKR': '₨',   'BDT': '৳',    'NPR': 'Rs',   'IDR': 'Rp',
    'BRL': 'R$',   'MXN': '$',    'PHP': '₱',    'MYR': 'RM',   'THB': '฿',
    'VND': '₫',    'NGN': '₦',   'KES': 'KSh',  'ZAR': 'R',    'RUB': '₽',
    'EGP': '£',    'LKR': 'Rs',   'TRY': '₺',    'AED': 'د.إ', 'SAR': '﷼',
    'QAR': '﷼',   'ILS': '₪',   'TWD': 'NT$',  'HUF': 'Ft',   'CZK': 'Kč',
    'PLN': 'zł',   'RON': 'lei',  'UAH': '₴',    'KZT': '₸',   'ARS': '$',
    'COP': '$',    'PEN': 'S/',   'GHS': '₵',    'TZS': 'Sh',   'MMK': 'K',
}

# Approximate fallback rates (used only when FX API is unreachable)
_FALLBACK_FX = {
    'USD': 1.0,      'EUR': 0.924,   'GBP': 0.792,   'INR': 84.0,    'JPY': 149.0,
    'AUD': 1.54,     'CAD': 1.37,    'CHF': 0.887,   'SGD': 1.34,    'HKD': 7.82,
    'KRW': 1330.0,   'SEK': 10.4,    'NOK': 10.6,    'DKK': 6.89,    'NZD': 1.63,
    'CNY': 7.24,     'PKR': 278.0,   'BDT': 110.0,   'NPR': 134.0,   'LKR': 310.0,
    'IDR': 16000.0,  'BRL': 4.97,    'MXN': 17.2,    'PHP': 56.0,    'MYR': 4.72,
    'THB': 34.7,     'VND': 25000.0, 'NGN': 1580.0,  'KES': 129.0,   'ZAR': 18.5,
    'RUB': 91.0,     'EGP': 49.0,    'TRY': 32.0,    'AED': 3.67,    'SAR': 3.75,
    'QAR': 3.64,     'ILS': 3.75,    'TWD': 31.5,    'HUF': 358.0,   'CZK': 22.8,
    'PLN': 3.97,     'RON': 4.57,    'UAH': 39.5,    'KZT': 450.0,   'ARS': 900.0,
    'COP': 3950.0,   'PEN': 3.72,    'GHS': 15.2,    'TZS': 2520.0,
}


def refresh_eye_rates(force=False):
    """Fetch live FX from API and upsert eye_rates. Skips if rates are fresh (< 23h old)."""
    if 'postgresql' not in str(db.engine.url):
        return  # skip on SQLite dev

    from sqlalchemy import text

    # Skip if fresh enough
    if not force:
        try:
            with db.engine.connect() as conn:
                count = conn.execute(text('SELECT COUNT(*) FROM eye_rates')).scalar()
                if count > 0:
                    stale = conn.execute(text(
                        "SELECT COUNT(*) FROM eye_rates "
                        "WHERE updated_at < NOW() - INTERVAL '23 hours'"
                    )).scalar()
                    if stale == 0:
                        return
        except Exception:
            return

    fx = None
    try:
        req = urllib.request.Request(
            'https://api.exchangerate-api.com/v4/latest/USD',
            headers={'User-Agent': 'Veyra/1.0'},
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read())
        fx = data.get('rates', {})
        fx['USD'] = 1.0
        print(f'[eye_rates] Fetched live rates ({len(fx)} currencies)')
    except Exception as e:
        warnings.warn(f'[eye_rates] API fetch failed ({e}) — using fallback rates')
        fx = _FALLBACK_FX.copy()

    try:
        with db.engine.begin() as conn:
            for cur, usd_rate in fx.items():
                local_per_eye = float(usd_rate) * _EYE_USD
                buy   = round(local_per_eye * (1 + _SPREAD), 8)
                sell  = round(local_per_eye * (1 - _SPREAD), 8)
                min_t = _MIN_TOPUP.get(cur, _DEFAULT_MIN)
                sym   = _SYMBOLS.get(cur, cur)
                conn.execute(text('''
                    INSERT INTO eye_rates
                        (currency, buy_rate, sell_rate, min_topup, symbol, updated_at)
                    VALUES (:c, :b, :s, :m, :sym, NOW())
                    ON CONFLICT (currency) DO UPDATE
                        SET buy_rate=:b, sell_rate=:s, min_topup=:m, updated_at=NOW()
                '''), {'c': cur, 'b': buy, 's': sell, 'm': min_t, 'sym': sym})
        print(f'[eye_rates] Upserted {len(fx)} rate rows')
    except Exception as e:
        warnings.warn(f'[eye_rates] DB upsert failed: {e}')
