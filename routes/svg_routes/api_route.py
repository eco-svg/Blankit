from flask import Blueprint, jsonify, request
from datetime import date
from svg_models import db
from svg_models.habit import Habit
from svg_models.habit_log import HabitLog
from svg_models.todo import Todo
from svg_services import habit_service, badge_service

api = Blueprint('api', __name__, url_prefix='/api')


@api.route('/habits', methods=['GET'])
def get_habits():
    """Get all active habits with today's completion status."""
    return jsonify(habit_service.get_today_habits())


@api.route('/habits', methods=['POST'])
def add_habit():
    """Add a new habit. Body: { name, track_type }"""
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    habit = Habit(
        name       = name,
        track_type = data.get('track_type', 'manual')
    )
    db.session.add(habit)
    db.session.commit()
    return jsonify(habit.to_dict()), 201


@api.route('/habits/<int:habit_id>', methods=['DELETE'])
def delete_habit(habit_id):
    """Soft-delete a habit (set is_active=False)."""
    habit = Habit.query.get_or_404(habit_id)
    habit.is_active = False
    db.session.commit()
    return jsonify({'success': True})


@api.route('/habits/<int:habit_id>/toggle', methods=['POST'])
def toggle_habit(habit_id):
    """Toggle habit done/undone for today. Returns new state + newly unlocked badges."""
    Habit.query.get_or_404(habit_id)
    done          = habit_service.toggle_habit(habit_id)
    new_badges    = badge_service.check_and_unlock(habit_id)
    _, _, pct     = habit_service.get_completion_today()
    score         = habit_service.get_discipline_score()
    return jsonify({
        'done':           done,
        'completion_pct': pct,
        'discipline':     score,
        'new_badges':     new_badges,
    })




@api.route('/stats/today', methods=['GET'])
def stats_today():
    done, total, pct = habit_service.get_completion_today()
    score            = habit_service.get_discipline_score()
    return jsonify({
        'done':           done,
        'total':          total,
        'completion_pct': pct,
        'discipline':     score,
    })


@api.route('/stats/weekly', methods=['GET'])
def stats_weekly():
    return jsonify(habit_service.get_weekly_stats())


@api.route('/stats/monthly', methods=['GET'])
def stats_monthly():
    return jsonify(habit_service.get_monthly_stats())


@api.route('/stats/yearly', methods=['GET'])
def stats_yearly():
    return jsonify(habit_service.get_yearly_heatmap())




@api.route('/todos/<string:date_str>', methods=['GET'])
def get_todos(date_str):
    """Get all todos for a date. date_str format: YYYY-MM-DD"""
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    todos = Todo.query.filter_by(date=d).order_by(Todo.created_at).all()
    return jsonify([t.to_dict() for t in todos])


@api.route('/todos/<string:date_str>', methods=['POST'])
def add_todo(date_str):
    """Add a todo for a date. Body: { text, priority }"""
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    data = request.get_json()
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Text is required'}), 400

    todo = Todo(
        text     = text,
        date     = d,
        priority = data.get('priority', 'medium')
    )
    db.session.add(todo)
    db.session.commit()
    return jsonify(todo.to_dict()), 201


@api.route('/todos/item/<int:todo_id>/toggle', methods=['POST'])
def toggle_todo(todo_id):
    """Toggle a todo done/undone."""
    todo      = Todo.query.get_or_404(todo_id)
    todo.done = not todo.done
    db.session.commit()
    return jsonify(todo.to_dict())


@api.route('/todos/item/<int:todo_id>', methods=['DELETE'])
def delete_todo(todo_id):
    """Delete a todo."""
    todo = Todo.query.get_or_404(todo_id)
    db.session.delete(todo)
    db.session.commit()
    return jsonify({'success': True})




@api.route('/badges', methods=['GET'])
def get_badges():
    """Get all badges with earned status and podium rank."""
    return jsonify(badge_service.get_all_badges_with_status())


@api.route('/badges/<int:badge_id>/podium', methods=['POST'])
def set_podium(badge_id):
    """Set podium rank for a badge. Body: { rank: 1|2|3 }"""
    data = request.get_json()
    rank = data.get('rank')
    if rank not in [1, 2, 3]:
        return jsonify({'error': 'Rank must be 1, 2 or 3'}), 400

    success = badge_service.set_podium_rank(badge_id, rank)
    if not success:
        return jsonify({'error': 'Badge not earned yet'}), 400
    return jsonify({'success': True})