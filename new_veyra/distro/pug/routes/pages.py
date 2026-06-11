"""Page routes + presence ping."""
from datetime import datetime

from flask import render_template, session

from shared.extensions import db
from . import pug_bp
from .guards import login_required_page


@pug_bp.before_request
def _ping_last_seen():
    """Update presence at most every 2 minutes; also migrate legacy distro name."""
    uid = session.get('user_id')
    if not uid:
        return
    from shared.auth.user import User
    try:
        u = db.session.get(User, uid)
        if not u:
            return
        dirty = False
        if u.distro == 'ThePug':
            u.distro = 'Ocellus'
            dirty = True
        if dirty or session.get('distro') == 'ThePug':
            session['distro'] = 'Ocellus'
        now = datetime.utcnow()
        if u.last_seen is None or (now - u.last_seen).total_seconds() > 120:
            u.last_seen = now
            dirty = True
        if dirty:
            db.session.commit()
    except Exception:
        db.session.rollback()


@pug_bp.route('/pug/home')
@login_required_page
def home():
    from shared.auth.user import User
    u = db.session.get(User, session['user_id'])
    return render_template(
        'pug/home.html',
        username=session.get('username', 'User'),
        is_admin=bool(u and u.is_admin),
    )


@pug_bp.route('/pug/terms')
def pug_terms():
    return render_template('pug/terms.html')
