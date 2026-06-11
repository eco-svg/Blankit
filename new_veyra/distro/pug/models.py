"""
Ocellus data models.

Schema is intentionally identical to the previous generation so existing
production data keeps working.  The `Note` table is a polymorphic store:
`entry_type` selects the kind of row, and for relational kinds (`dm`,
`post_react`, `post_comment`, ...) the `mood` column holds the related id.
All packing/unpacking of JSON bodies lives here, not in the routes.
"""
import json
import urllib.request
import warnings
from datetime import datetime

from distro.pug.extensions import encrypt, decrypt
from shared.extensions import db
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

    # ── JSON body helpers ────────────────────────────────────────────────
    def body_json(self):
        """Decode the body as JSON if it looks like JSON, else {}."""
        raw = self.body or ''
        if raw.startswith('{'):
            try:
                return json.loads(raw)
            except Exception:
                pass
        return {}

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


# ── Community post body codec ────────────────────────────────────────────────
# Posts store either plain text or a JSON object:
#   t = text, m = media key, pt = post type, pin = pinned comment id,
#   to = text order ('tm'|'mt'), sk = skill tag

def pack_post_body(text='', media_key=None, post_type=None, pinned=None,
                   text_order=None, skill_tag=None):
    fields = {'t': text, 'm': media_key, 'pt': post_type, 'pin': pinned,
              'to': text_order, 'sk': skill_tag}
    fields = {k: v for k, v in fields.items() if v}
    if list(fields.keys()) in ([], ['t']):
        return text
    return json.dumps(fields)


def unpack_post_body(raw):
    """Return dict(text, media_key, post_type, pinned_cid, text_order, skill_tag)."""
    out = {'text': raw or '', 'media_key': None, 'post_type': None,
           'pinned_cid': None, 'text_order': 'tm', 'skill_tag': None}
    if raw and raw.startswith('{'):
        try:
            d = json.loads(raw)
            out.update(
                text       = d.get('t', ''),
                media_key  = d.get('m'),
                post_type  = d.get('pt'),
                pinned_cid = d.get('pin'),
                text_order = d.get('to', 'tm'),
                skill_tag  = d.get('sk'),
            )
        except Exception:
            pass
    return out


# ── Achievement body codec ───────────────────────────────────────────────────
# d = description, p = proof text, vs = verify status ('link'|'media'),
# vl = verify link, vm = verify media key

def unpack_achievement_body(raw):
    out = {'desc': '', 'proof': '', 'verify_status': None, 'verify_link': '', 'verify_media': ''}
    if not raw:
        return out
    if raw.startswith('{'):
        try:
            d = json.loads(raw)
            out.update(desc=d.get('d', ''), proof=d.get('p', ''),
                       verify_status=d.get('vs'), verify_link=d.get('vl', ''),
                       verify_media=d.get('vm', ''))
            return out
        except Exception:
            pass
    out['desc'] = raw
    return out


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
    ref_id     = db.Column(db.String(100))                 # order/post id if relevant
    note       = db.Column(db.String(300))
    status     = db.Column(db.String(20), default='pending')  # pending|completed|rejected|cancelled
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


# ── Eye/FX rates ─────────────────────────────────────────────────────────────

_EYE_USD  = 0.01   # 1 Eye = $0.01 (base)
_SPREAD   = 0.10   # 10% spread between buy and sell rates

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
