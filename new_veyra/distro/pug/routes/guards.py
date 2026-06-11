"""Auth decorators for Ocellus routes."""
from functools import wraps
from flask import session, jsonify, redirect, url_for

from shared.extensions import db


def _session_ok():
    return bool(session.get('user_id')) and session.get('distro') == 'Ocellus'


def login_required(fn):
    """JSON-API guard: 401 when not logged in, 403 when wrong distro."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'Not authenticated'}), 401
        if session.get('distro') != 'Ocellus':
            return jsonify({'error': 'Forbidden'}), 403
        return fn(*args, **kwargs)
    return wrapper


def login_required_page(fn):
    """Page guard: redirect to login instead of returning JSON."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _session_ok():
            return redirect(url_for('svg.login'))
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    """Admin guard — checks the is_admin flag in the DB, never the session alone."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'Not authenticated'}), 401
        if session.get('distro') != 'Ocellus':
            return jsonify({'error': 'Forbidden'}), 403
        from shared.auth.user import User
        u = db.session.get(User, session['user_id'])
        if not u or not u.is_admin:
            return jsonify({'error': 'Forbidden'}), 403
        return fn(*args, **kwargs)
    return wrapper


def current_user_id():
    return session.get('user_id')
