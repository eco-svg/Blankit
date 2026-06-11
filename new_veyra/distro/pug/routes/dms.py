"""Direct messages.  Rows are Note(entry_type='dm'); `mood` holds the
recipient id, `is_finished` doubles as the read flag."""
import json
from datetime import datetime

from flask import jsonify, request, session, url_for

from shared.extensions import db, limiter
from distro.pug.models import Note
from . import pug_bp
from .guards import login_required
from .helpers import connection_count, is_online


def _unpack_dm(raw):
    """DM bodies are plain text or {'t': text, 'm': media_key}."""
    text, media_key = raw or '', None
    if raw and raw.startswith('{'):
        try:
            bd = json.loads(raw)
            text      = bd.get('t', '')
            media_key = bd.get('m')
        except Exception:
            pass
    return text, media_key


@pug_bp.route('/pug/api/dms', methods=['GET'])
@login_required
def list_dms():
    from shared.auth.user import User
    me = session['user_id']
    sent     = Note.query.filter_by(user_id=me,  entry_type='dm', is_deleted=False).all()
    received = Note.query.filter_by(mood=str(me), entry_type='dm', is_deleted=False).all()
    all_msgs = sorted(sent + received, key=lambda m: m.created_at or datetime.min, reverse=True)

    latest_by_peer = {}
    for m in all_msgs:
        other_id = int(m.mood) if m.user_id == me else m.user_id
        if other_id not in latest_by_peer:
            latest_by_peer[other_id] = m

    peers = {u.id: u for u in User.query.filter(User.id.in_(list(latest_by_peer))).all()} \
        if latest_by_peer else {}

    result = []
    for other_id, last_msg in latest_by_peer.items():
        u = peers.get(other_id)
        if not u:
            continue
        unread_count = Note.query.filter_by(
            user_id=other_id, mood=str(me), entry_type='dm',
            is_deleted=False, is_finished=False
        ).count()
        text, media_key = _unpack_dm(last_msg.body or '')
        if not text and media_key:
            text = '[media]'
        result.append({
            'other_id':     other_id,
            'username':     u.username,
            'last_msg':     text[:60],
            'last_time':    last_msg.created_at.isoformat() if last_msg.created_at else None,
            'unread':       unread_count > 0,
            'unread_count': unread_count,
            'is_online':    is_online(u),
            'connections':  connection_count(other_id),
        })
    return jsonify(result)


@pug_bp.route('/pug/api/dms/<int:other_id>', methods=['GET'])
@login_required
def get_dm_thread(other_id):
    me = session['user_id']
    sent     = Note.query.filter_by(user_id=me,       mood=str(other_id), entry_type='dm', is_deleted=False).all()
    received = Note.query.filter_by(user_id=other_id, mood=str(me),       entry_type='dm', is_deleted=False).all()
    msgs = sorted(sent + received, key=lambda m: m.created_at or datetime.min)
    rows = []
    for m in msgs:
        text, media_key = _unpack_dm(m.body or '')
        media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
        rows.append({
            'id':         m.id,
            'body':       text,
            'media_key':  media_key,
            'media_url':  media_url,
            'is_mine':    m.user_id == me,
            'created_at': m.created_at.isoformat() if m.created_at else None,
        })
    return jsonify(rows)


@pug_bp.route('/pug/api/dms/<int:other_id>', methods=['POST'])
@limiter.limit("60 per hour; 10 per minute")
@login_required
def send_dm(other_id):
    from shared.auth.user import User
    me = session['user_id']
    if other_id == me:
        return jsonify({'error': 'Cannot DM yourself'}), 400
    recipient = User.query.filter(User.id == other_id,
                                  User.distro.in_(['Ocellus', 'ThePug'])).first()
    if not recipient:
        return jsonify({'error': 'User not found'}), 404
    data      = request.get_json(silent=True) or {}
    body      = (data.get('body') or '').strip()
    media_key = (data.get('media_key') or '').strip()
    if not body and not media_key:
        return jsonify({'error': 'Empty message'}), 400
    if media_key and not media_key.startswith('shared/'):
        return jsonify({'error': 'Invalid media key'}), 400
    if len(body) > 2000:
        return jsonify({'error': 'Message too long'}), 400

    m = Note(user_id=me, entry_type='dm', is_deleted=False, is_finished=False)
    m.body = json.dumps({'t': body, 'm': media_key}) if media_key else body
    m.mood = str(other_id)
    db.session.add(m)
    db.session.commit()
    media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
    return jsonify({
        'id':         m.id,
        'body':       body,
        'media_key':  media_key or None,
        'media_url':  media_url,
        'is_mine':    True,
        'created_at': m.created_at.isoformat() if m.created_at else None,
    }), 201


@pug_bp.route('/pug/api/dms/<int:other_id>/read', methods=['PATCH'])
@login_required
def mark_dms_read(other_id):
    me = session['user_id']
    Note.query.filter_by(
        user_id=other_id, mood=str(me), entry_type='dm',
        is_deleted=False, is_finished=False
    ).update({'is_finished': True})
    db.session.commit()
    return jsonify({'ok': True})
