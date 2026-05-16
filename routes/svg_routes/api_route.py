from flask import Blueprint, jsonify, request, session
from datetime import date
from svg_models import db
from svg_models.habit import Habit
from svg_models.habit_log import HabitLog
from svg_models.todo import Todo
from svg_services import habit_service, badge_service

api = Blueprint('api', __name__, url_prefix='/api')


def current_user_id():
    uid = session.get('user_id')
    if not uid:
        return None
    return uid


def require_user():
    uid = current_user_id()
    if not uid:
        from flask import abort
        abort(401)
    return uid


# ══════════════════════════════
#  HABITS
# ══════════════════════════════

@api.route('/habits', methods=['GET'])
def get_habits():
    user_id = require_user()
    return jsonify(habit_service.get_today_habits(user_id))


@api.route('/habits', methods=['POST'])
def add_habit():
    user_id = require_user()
    data    = request.get_json()
    name    = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    habit = Habit(
        user_id    = user_id,
        name       = name,
        track_type = data.get('track_type', 'manual')
    )
    db.session.add(habit)
    db.session.commit()
    return jsonify({**habit.to_dict(), 'done': False, 'streak': 0}), 201


@api.route('/habits/<int:habit_id>', methods=['DELETE'])
def delete_habit(habit_id):
    user_id = require_user()
    habit   = Habit.query.filter_by(id=habit_id, user_id=user_id).first_or_404()
    habit.is_active = False
    db.session.commit()
    return jsonify({'success': True})


@api.route('/habits/<int:habit_id>/toggle', methods=['POST'])
def toggle_habit(habit_id):
    user_id = require_user()
    # verify habit belongs to user
    Habit.query.filter_by(id=habit_id, user_id=user_id).first_or_404()
    done       = habit_service.toggle_habit(habit_id)
    new_badges = badge_service.check_and_unlock(habit_id)
    _, _, pct  = habit_service.get_completion_today(user_id)
    score      = habit_service.get_discipline_score(user_id)
    return jsonify({
        'done':           done,
        'completion_pct': pct,
        'discipline':     score,
        'new_badges':     new_badges,
    })


# ══════════════════════════════
#  STATS
# ══════════════════════════════

@api.route('/stats/today', methods=['GET'])
def stats_today():
    user_id      = require_user()
    done, total, pct = habit_service.get_completion_today(user_id)
    score        = habit_service.get_discipline_score(user_id)
    return jsonify({'done': done, 'total': total, 'completion_pct': pct, 'discipline': score})


@api.route('/stats/weekly', methods=['GET'])
def stats_weekly():
    return jsonify(habit_service.get_weekly_stats(require_user()))


@api.route('/stats/monthly', methods=['GET'])
def stats_monthly():
    return jsonify(habit_service.get_monthly_stats(require_user()))


@api.route('/stats/yearly', methods=['GET'])
def stats_yearly():
    return jsonify(habit_service.get_yearly_heatmap(require_user()))


# ══════════════════════════════
#  TODOS
# ══════════════════════════════

@api.route('/todos/<string:date_str>', methods=['GET'])
def get_todos(date_str):
    user_id = require_user()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    todos = Todo.query.filter_by(date=d, user_id=user_id).order_by(Todo.created_at).all()
    return jsonify([t.to_dict() for t in todos])


@api.route('/todos/<string:date_str>', methods=['POST'])
def add_todo(date_str):
    user_id = require_user()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400
    data = request.get_json()
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Text is required'}), 400
    todo = Todo(text=text, date=d, priority=data.get('priority', 'medium'), user_id=user_id)
    db.session.add(todo)
    db.session.commit()
    return jsonify(todo.to_dict()), 201


@api.route('/todos/item/<int:todo_id>/toggle', methods=['POST'])
def toggle_todo(todo_id):
    user_id   = require_user()
    todo      = Todo.query.filter_by(id=todo_id, user_id=user_id).first_or_404()
    todo.done = not todo.done
    db.session.commit()
    return jsonify(todo.to_dict())


@api.route('/todos/item/<int:todo_id>', methods=['DELETE'])
def delete_todo(todo_id):
    user_id = require_user()
    todo    = Todo.query.filter_by(id=todo_id, user_id=user_id).first_or_404()
    db.session.delete(todo)
    db.session.commit()
    return jsonify({'success': True})


# ══════════════════════════════
#  BADGES
# ══════════════════════════════

@api.route('/badges', methods=['GET'])
def get_badges():
    require_user()
    return jsonify(badge_service.get_all_badges_with_status())


@api.route('/badges/<int:badge_id>/podium', methods=['POST'])
def set_podium(badge_id):
    require_user()
    data = request.get_json()
    rank = data.get('rank')
    if rank not in [1, 2, 3]:
        return jsonify({'error': 'Rank must be 1, 2 or 3'}), 400
    success = badge_service.set_podium_rank(badge_id, rank)
    if not success:
        return jsonify({'error': 'Badge not earned yet'}), 400
    return jsonify({'success': True})