"""Ask Me Anything — human-answered questions.
One free question per day; extras cost 1 Eye.
Admin endpoints require the is_admin DB flag."""
from datetime import datetime

from flask import jsonify, request, session

from shared.extensions import db, limiter
from distro.pug.models import AmaMessage, Note, WalletTx
from . import pug_bp
from .guards import admin_required, login_required
from .wallet import get_or_create_wallet

FREE_QUESTIONS_PER_DAY = 1


def _today_question_count(uid):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return AmaMessage.query.filter(
        AmaMessage.user_id == uid,
        AmaMessage.is_admin == False,
        AmaMessage.created_at >= today_start,
    ).count()


@pug_bp.route('/pug/api/ama', methods=['GET'])
@login_required
def ama_get():
    uid  = session['user_id']
    msgs = AmaMessage.query.filter_by(user_id=uid).order_by(AmaMessage.created_at.asc()).all()
    w    = get_or_create_wallet(uid)
    return jsonify({
        'messages': [{'id': m.id, 'body': m.body, 'is_admin': m.is_admin,
                      'created_at': m.created_at.isoformat()} for m in msgs],
        'today_count': _today_question_count(uid),
        'balance': w.balance,
    })


@pug_bp.route('/pug/api/ama', methods=['POST'])
@limiter.limit("20 per hour")
@login_required
def ama_ask():
    uid  = session['user_id']
    body = request.get_json(silent=True) or {}
    text = (body.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty question'}), 400
    if len(text) > 2000:
        return jsonify({'error': 'Question too long (max 2000 chars)'}), 400

    if _today_question_count(uid) >= FREE_QUESTIONS_PER_DAY:
        w = get_or_create_wallet(uid)
        if w.balance < 1:
            return jsonify({'error': 'insufficient_eyes',
                            'message': 'You need 1 Eye for extra questions today.'}), 402
        w.balance -= 1
        db.session.add(WalletTx(
            user_id=uid, tx_type='spend', amount=-1,
            note='Ask Anything: extra question', status='completed',
        ))

    msg = AmaMessage(user_id=uid, body=text, is_admin=False)
    db.session.add(msg)

    # Mirror the question into the admin's DM stream
    from shared.auth.user import User
    asker = db.session.get(User, uid)
    admin = User.query.filter_by(is_admin=True).first()
    if admin and asker and admin.id != uid:
        dm = Note(user_id=uid, entry_type='dm', is_deleted=False, is_finished=False)
        dm.body = f"[Ask Anything]\nFrom: {asker.username}\n\n{text}"
        dm.mood = str(admin.id)
        db.session.add(dm)

    db.session.commit()
    return jsonify({'ok': True, 'id': msg.id, 'created_at': msg.created_at.isoformat()})


# ── Admin inbox ──────────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/admin/ama', methods=['GET'])
@admin_required
def admin_ama_list():
    from sqlalchemy import func
    from shared.auth.user import User
    rows = (db.session.query(AmaMessage.user_id, func.max(AmaMessage.created_at).label('last_at'))
            .group_by(AmaMessage.user_id)
            .order_by(func.max(AmaMessage.created_at).desc())
            .all())
    users = {u.id: u for u in User.query.filter(User.id.in_([r.user_id for r in rows])).all()} \
        if rows else {}
    result = []
    for row in rows:
        u = users.get(row.user_id)
        if not u:
            continue
        latest = AmaMessage.query.filter_by(user_id=row.user_id)\
                                 .order_by(AmaMessage.created_at.desc()).first()
        result.append({
            'user_id':       row.user_id,
            'username':      u.username,
            'last_at':       row.last_at.isoformat() if row.last_at else None,
            'preview':       latest.body[:80] if latest else '',
            'is_admin_last': latest.is_admin if latest else False,
        })
    return jsonify(result)


@pug_bp.route('/pug/api/admin/ama/<int:uid>', methods=['GET'])
@admin_required
def admin_ama_thread(uid):
    from shared.auth.user import User
    u    = db.session.get(User, uid)
    msgs = AmaMessage.query.filter_by(user_id=uid).order_by(AmaMessage.created_at.asc()).all()
    return jsonify({
        'username': u.username if u else str(uid),
        'messages': [{'id': m.id, 'body': m.body, 'is_admin': m.is_admin,
                      'created_at': m.created_at.isoformat()} for m in msgs],
    })


@pug_bp.route('/pug/api/admin/ama/<int:uid>/reply', methods=['POST'])
@admin_required
def admin_ama_reply(uid):
    from shared.auth.user import User
    if not db.session.get(User, uid):
        return jsonify({'error': 'User not found'}), 404
    body = request.get_json(silent=True) or {}
    text = (body.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty reply'}), 400
    msg = AmaMessage(user_id=uid, body=text, is_admin=True)
    db.session.add(msg)
    db.session.commit()
    return jsonify({'ok': True, 'id': msg.id, 'created_at': msg.created_at.isoformat()})
