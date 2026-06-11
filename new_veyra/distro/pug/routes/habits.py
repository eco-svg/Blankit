"""Habits: CRUD, daily toggle, history."""
from datetime import date, timedelta

from flask import jsonify, request, session
from sqlalchemy.exc import IntegrityError

from shared.extensions import db, limiter
from . import pug_bp
from .guards import login_required


@pug_bp.route('/pug/api/habits', methods=['GET'])
@limiter.limit("60 per minute")
@login_required
def get_habits():
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    habits = Habit.query.filter_by(
        user_id=session['user_id'], is_active=True
    ).order_by(Habit.created_at).all()
    today  = date.today()
    result = []
    for h in habits:
        log = HabitLog.query.filter_by(habit_id=h.id, date=today).first()
        d = h.to_dict()
        d['done_today'] = log.done if log else False
        result.append(d)
    return jsonify(result)


@pug_bp.route('/pug/api/habits', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def create_habit():
    from distro.svg.models.habit import Habit
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()[:120]
    if not name:
        return jsonify({'error': 'name required'}), 400
    h = Habit(user_id=session['user_id'], name=name)
    db.session.add(h)
    db.session.commit()
    return jsonify(h.to_dict()), 201


@pug_bp.route('/pug/api/habits/<int:habit_id>', methods=['DELETE'])
@limiter.limit("20 per minute")
@login_required
def delete_habit(habit_id):
    from distro.svg.models.habit import Habit
    h = Habit.query.filter_by(id=habit_id, user_id=session['user_id']).first_or_404()
    db.session.delete(h)
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/habits/<int:habit_id>/toggle', methods=['POST'])
@limiter.limit("60 per minute")
@login_required
def toggle_habit(habit_id):
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    Habit.query.filter_by(id=habit_id, user_id=session['user_id']).first_or_404()
    today = date.today()
    log = HabitLog.query.filter_by(habit_id=habit_id, date=today).first()
    if log:
        log.done = not log.done
    else:
        log = HabitLog(habit_id=habit_id, date=today, done=True)
        db.session.add(log)
    try:
        db.session.commit()
    except IntegrityError:
        # Concurrent first-toggle for the same day — flip the row that won
        db.session.rollback()
        log = HabitLog.query.filter_by(habit_id=habit_id, date=today).first()
        log.done = not log.done
        db.session.commit()
    return jsonify({'done': log.done})


@pug_bp.route('/pug/api/habits/history', methods=['GET'])
@limiter.limit("20 per minute")
@login_required
def habits_history():
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    try:
        days = min(int(request.args.get('days', 30)), 90)
    except ValueError:
        days = 30
    habits = Habit.query.filter_by(user_id=session['user_id'], is_active=True).all()
    if not habits:
        return jsonify([])
    habit_ids = [h.id for h in habits]
    today  = date.today()
    result = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        done = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date == d,
            HabitLog.done == True
        ).count()
        result.append({'date': d.isoformat(), 'pct': round((done / len(habit_ids)) * 100)})
    return jsonify(result)
