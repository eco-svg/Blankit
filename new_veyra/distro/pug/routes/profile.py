"""Profile: username/password changes, account deletion, public profiles,
user search, location."""
import json
from datetime import datetime

from flask import jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from shared.extensions import db, limiter
from distro.pug.models import Note
from . import pug_bp
from .guards import login_required
from .helpers import (connection_count, get_cached_sheet, is_online,
                      net_rank_for_user)


@pug_bp.route('/pug/api/profile/username', methods=['PATCH'])
@limiter.limit("10 per hour")
@login_required
def update_username():
    from shared.auth.user import User
    data     = request.get_json(silent=True) or {}
    new_name = (data.get('username') or '').strip()
    if not new_name or len(new_name) < 2 or len(new_name) > 50:
        return jsonify({'error': 'Username must be 2–50 characters'}), 400
    if User.query.filter(User.username == new_name, User.id != session['user_id']).first():
        return jsonify({'error': 'Username taken'}), 409
    user = db.session.get(User, session['user_id'])
    user.username = new_name
    session['username'] = new_name
    db.session.commit()
    return jsonify({'ok': True, 'username': new_name})


@pug_bp.route('/pug/api/profile/password', methods=['PATCH'])
@limiter.limit("10 per hour")
@login_required
def update_password():
    from shared.auth.user import User
    data         = request.get_json(silent=True) or {}
    current      = data.get('current', '')
    new_password = data.get('new', '')
    if not new_password or len(new_password) < 8:
        return jsonify({'error': 'Password too short (min 8 chars)'}), 400
    user = db.session.get(User, session['user_id'])
    if not check_password_hash(user.password_hash, current):
        return jsonify({'error': 'Current password is wrong'}), 403
    user.password_hash = generate_password_hash(new_password)
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/profile/delete', methods=['DELETE'])
@limiter.limit("5 per 15 minutes")
@login_required
def delete_account():
    from shared.auth.user import User
    data     = request.get_json(silent=True) or {}
    password = data.get('password', '')
    user     = db.session.get(User, session['user_id'])
    if not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Wrong password'}), 403
    Note.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    session.clear()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/users/<int:uid>/profile')
@login_required
def get_user_profile(uid):
    from shared.auth.user import User
    u = db.session.get(User, uid)
    if not u or u.distro != 'Ocellus':
        return jsonify({'error': 'Not found'}), 404
    rank, color = net_rank_for_user(uid)
    return jsonify({
        'id':          uid,
        'username':    u.username,
        'rank':        rank,
        'rank_color':  color,
        'sheet':       get_cached_sheet(uid),
        'is_online':   is_online(u),
        'connections': connection_count(uid),
    })


@pug_bp.route('/pug/api/users/search')
@login_required
def search_users():
    from shared.auth.user import User
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify([])
    matches = User.query.filter(
        User.username.ilike(f'%{q}%'),
        User.id != session['user_id'],
        User.distro.in_(['Ocellus', 'ThePug'])
    ).limit(10).all()
    result = []
    for u in matches:
        rank, color = net_rank_for_user(u.id)
        result.append({'id': u.id, 'username': u.username, 'rank': rank,
                       'rank_color': color, 'is_online': is_online(u)})
    return jsonify(result)


@pug_bp.route('/pug/api/location', methods=['POST'])
@login_required
def save_location():
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data['lat'])
        lng = float(data['lng'])
    except (KeyError, ValueError, TypeError):
        return jsonify({'error': 'lat and lng required'}), 400
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({'error': 'coordinates out of range'}), 400
    existing = Note.query.filter_by(
        user_id=session['user_id'], entry_type='user_location', is_deleted=False
    ).first()
    if not existing:
        existing = Note(user_id=session['user_id'], entry_type='user_location',
                        is_deleted=False, is_finished=False)
        existing.title = 'location'
        db.session.add(existing)
    existing.body = json.dumps({'lat': lat, 'lng': lng})
    existing.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'ok': True})
