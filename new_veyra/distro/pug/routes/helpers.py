"""Cross-feature helpers: rank lookups, presence, location, sheet cache, EXP."""
import json
import math
import os
from datetime import datetime

from shared.extensions import db
from distro.pug.models import Note

RANK_ORDER = ['S+', 'S', 'S-', 'A+', 'A', 'A-', 'B+', 'B', 'B-',
              'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E+', 'E', 'E-', 'F']

RANK_COLORS = {
    'S+': '#ffd700', 'S': '#ffb700', 'S-': '#ffa500',
    'A+': '#ff7c4d', 'A': '#ff8c42', 'A-': '#e8854a',
    'B+': '#5a8fc8', 'B': '#4a7aaa', 'B-': '#4070a0',
    'C+': '#8ac888', 'C': '#78b878', 'C-': '#68a068',
    'D+': '#a0a0a0', 'D': '#888888', 'D-': '#707070',
    'E+': '#c87040', 'E': '#c06030', 'E-': '#a85028', 'F': '#803010',
}


# ── Character-sheet cache (entry_type='stats_cache') ─────────────────────────

def get_cached_sheet(user_id):
    n = Note.query.filter_by(user_id=user_id, entry_type='stats_cache', is_deleted=False).first()
    if n and n.body:
        try:
            return json.loads(n.body)
        except Exception:
            pass
    return None


def save_cached_sheet(user_id, sheet):
    n = Note.query.filter_by(user_id=user_id, entry_type='stats_cache', is_deleted=False).first()
    if not n:
        n = Note(user_id=user_id, entry_type='stats_cache', is_deleted=False, is_finished=False)
        db.session.add(n)
    n.title = 'stats_cache'
    n.body  = json.dumps(sheet)
    n.updated_at = datetime.utcnow()
    db.session.commit()


def bust_cached_sheet(user_id):
    n = Note.query.filter_by(user_id=user_id, entry_type='stats_cache', is_deleted=False).first()
    if n:
        db.session.delete(n)
        db.session.commit()


def net_rank_for_user(uid):
    """Best verified rank from the user's sheet → (rank_str, color) or (None, None)."""
    sheet = get_cached_sheet(uid)
    if not sheet:
        return None, None
    skills = sheet.get('skills', [])
    for r in RANK_ORDER:
        if any(s.get('rank', '').upper() == r and s.get('verified', True) for s in skills):
            return r, RANK_COLORS.get(r, '#888')
    return None, None


def user_has_skill(uid, skill_name):
    """True if the user has a verified skill whose name contains skill_name (case-insensitive)."""
    sheet = get_cached_sheet(uid)
    if not sheet:
        return False
    return any(
        s.get('verified', False) and skill_name in (s.get('name') or '').lower()
        for s in sheet.get('skills', [])
    )


# ── Presence / location ──────────────────────────────────────────────────────

def is_online(u):
    if not u or not u.last_seen:
        return False
    return (datetime.utcnow() - u.last_seen).total_seconds() < 300


def user_location(uid):
    n = Note.query.filter_by(user_id=uid, entry_type='user_location', is_deleted=False).first()
    if not n or not n.body:
        return None, None
    try:
        d = json.loads(n.body)
        return float(d['lat']), float(d['lng'])
    except Exception:
        return None, None


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


def connection_count(uid):
    from sqlalchemy import distinct
    sent = db.session.query(distinct(Note.mood)).filter(
        Note.user_id == uid, Note.entry_type == 'dm', Note.is_deleted == False
    ).all()
    recv = db.session.query(distinct(Note.user_id)).filter(
        Note.mood == str(uid), Note.entry_type == 'dm', Note.is_deleted == False
    ).all()
    ids = set()
    for r in sent:
        if r[0] and str(r[0]).lstrip('-').isdigit():
            ids.add(int(r[0]))
    for r in recv:
        ids.add(r[0])
    return len(ids)


# ── EXP engine ───────────────────────────────────────────────────────────────

_EXP_CONFIG = None


def get_exp_config():
    global _EXP_CONFIG
    if _EXP_CONFIG is None:
        path = os.path.join(os.path.dirname(__file__), '..', 'static', 'exp_config.json')
        try:
            with open(path) as f:
                _EXP_CONFIG = json.load(f)
        except Exception:
            _EXP_CONFIG = {}
    return _EXP_CONFIG


def exp_rank(total_exp):
    th = get_exp_config().get('rank_thresholds', {})
    for r in RANK_ORDER:
        if th.get(r) is not None and total_exp >= th[r]:
            return r
    return 'F'


def award_exp(user_id, skill_name, action, count=1):
    """Award EXP to a named skill for a community action. Returns updated sheet or None."""
    weight = get_exp_config().get('action_weights', {}).get(action, 0)
    delta  = weight * count
    if delta <= 0:
        return None
    sheet  = get_cached_sheet(user_id) or {}
    skills = sheet.get('skills', [])
    for s in skills:
        if s.get('name') == skill_name:
            s['exp']  = round(s.get('exp', 0) + delta, 2)
            s['rank'] = exp_rank(s['exp'])
            break
    sheet['skills'] = skills
    save_cached_sheet(user_id, sheet)
    return sheet


def post_skill_tag(post):
    """Extract the skill tag from a community post Note, or None."""
    return post.body_json().get('sk') or None
