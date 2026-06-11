"""Notes (journal), goals, dream, calendar events, consistency chart."""
from datetime import datetime, timedelta

from flask import jsonify, request, session

from shared.extensions import db
from distro.pug.models import Note
from . import pug_bp
from .guards import login_required

MAX_TITLE = 500
MAX_BODY  = 100_000


def _parse_start_dt(raw):
    if not raw:
        return None
    try:
        return datetime.strptime(raw, '%Y-%m-%d')
    except ValueError:
        return None


# ── Notes ────────────────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/notes', methods=['GET'])
@login_required
def get_notes():
    notes = Note.query.filter_by(
        user_id=session['user_id'], entry_type='note', is_deleted=False
    ).order_by(Note.updated_at.desc()).all()
    return jsonify([n.to_dict() for n in notes])


@pug_bp.route('/pug/api/notes', methods=['POST'])
@login_required
def save_note():
    data  = request.get_json(silent=True) or {}
    title = data.get('title', '')
    body  = data.get('body', '')
    if len(title) > MAX_TITLE:
        return jsonify({'status': 'error', 'message': 'Title too long'}), 400
    if len(body) > MAX_BODY:
        return jsonify({'status': 'error', 'message': 'Body too long'}), 400
    start_dt = _parse_start_dt(data.get('start_datetime'))

    note_id = data.get('id')
    if note_id:
        note = Note.query.filter_by(id=note_id, user_id=session['user_id']).first()
        if not note:
            return jsonify({'status': 'error', 'message': 'Not found'}), 404
        note.start_datetime = start_dt
        note.updated_at     = datetime.utcnow()
    else:
        note = Note(user_id=session['user_id'], entry_type='note', start_datetime=start_dt)
        db.session.add(note)
    note.title = title
    note.body  = body
    db.session.commit()
    return jsonify({'status': 'success', 'id': note.id})


@pug_bp.route('/pug/api/notes/<int:note_id>', methods=['DELETE'])
@login_required
def delete_note(note_id):
    note = Note.query.filter_by(id=note_id, user_id=session['user_id']).first_or_404()
    note.is_deleted = True
    db.session.commit()
    return jsonify({'status': 'success'})


# ── Goals ────────────────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/goals', methods=['GET'])
@login_required
def get_goals():
    goals = Note.query.filter_by(
        user_id=session['user_id'], entry_type='goal', is_deleted=False
    ).order_by(Note.created_at.asc()).all()
    return jsonify([g.to_dict() for g in goals])


@pug_bp.route('/pug/api/goals', methods=['POST'])
@login_required
def add_goal():
    data  = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'status': 'error'}), 400
    if len(title) > MAX_TITLE:
        return jsonify({'status': 'error', 'message': 'Title too long'}), 400
    goal = Note(user_id=session['user_id'], entry_type='goal')
    goal.title = title
    db.session.add(goal)
    db.session.commit()
    return jsonify({'status': 'success', 'id': goal.id})


@pug_bp.route('/pug/api/goals/<int:goal_id>', methods=['PATCH'])
@login_required
def update_goal(goal_id):
    goal = Note.query.filter_by(
        id=goal_id, user_id=session['user_id'], entry_type='goal'
    ).first_or_404()
    data = request.get_json(silent=True) or {}
    if 'is_finished' in data:
        goal.is_finished = bool(data['is_finished'])
    db.session.commit()
    return jsonify({'status': 'success'})


@pug_bp.route('/pug/api/goals/<int:goal_id>', methods=['DELETE'])
@login_required
def delete_goal(goal_id):
    goal = Note.query.filter_by(
        id=goal_id, user_id=session['user_id'], entry_type='goal'
    ).first_or_404()
    goal.is_deleted = True
    db.session.commit()
    return jsonify({'status': 'success'})


@pug_bp.route('/pug/api/goals/cancelled', methods=['GET'])
@login_required
def get_cancelled_goals():
    goals = Note.query.filter_by(
        user_id=session['user_id'], entry_type='goal',
        is_deleted=True, is_finished=False
    ).order_by(Note.updated_at.desc()).limit(20).all()
    return jsonify([g.to_dict() for g in goals])


# ── Dream ────────────────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/dream', methods=['GET'])
@login_required
def get_dream():
    dream = Note.query.filter_by(
        user_id=session['user_id'], entry_type='dream', is_deleted=False
    ).first()
    return jsonify({'dream': dream.title if dream else None})


@pug_bp.route('/pug/api/dream', methods=['POST'])
@login_required
def set_dream():
    existing = Note.query.filter_by(
        user_id=session['user_id'], entry_type='dream', is_deleted=False
    ).first()
    if existing:
        return jsonify({'status': 'error', 'message': 'Dream already locked'}), 409
    data  = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'status': 'error'}), 400
    dream = Note(user_id=session['user_id'], entry_type='dream')
    dream.title = title
    db.session.add(dream)
    db.session.commit()
    return jsonify({'status': 'success', 'dream': dream.title})


# ── Calendar events ──────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/events', methods=['GET'])
@login_required
def get_events():
    events = Note.query.filter(
        Note.user_id == session['user_id'],
        Note.is_deleted == False,
        Note.start_datetime != None
    ).all()
    return jsonify([{
        'id': e.id, 'title': e.title,
        'start_datetime': e.start_datetime.isoformat() if e.start_datetime else None
    } for e in events])


# ── Consistency (7-day goal activity) ────────────────────────────────────────

@pug_bp.route('/pug/api/consistency', methods=['GET'])
@login_required
def get_consistency():
    result = []
    today  = datetime.utcnow().date()
    for i in range(6, -1, -1):
        day   = today - timedelta(days=i)
        start = datetime(day.year, day.month, day.day, 0, 0, 0)
        end   = datetime(day.year, day.month, day.day, 23, 59, 59)
        base  = [Note.user_id == session['user_id'], Note.entry_type == 'goal']
        added = Note.query.filter(
            *base, Note.is_deleted == False,
            Note.created_at >= start, Note.created_at <= end
        ).count()
        finished = Note.query.filter(
            *base, Note.is_deleted == False, Note.is_finished == True,
            Note.updated_at >= start, Note.updated_at <= end
        ).count()
        dropped = Note.query.filter(
            *base, Note.is_deleted == True, Note.is_finished == False,
            Note.updated_at >= start, Note.updated_at <= end
        ).count()
        result.append({'day': day.strftime('%a'), 'added': added,
                       'finished': finished, 'dropped': dropped})
    return jsonify(result)
