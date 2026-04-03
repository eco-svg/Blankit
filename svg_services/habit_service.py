from datetime import date, timedelta
from svg_models.habit import Habit
from svg_models.habit_log import HabitLog
from svg_models import db

def get_today_habits():
    """Return all active habits with today's completion status."""
    today   = date.today()
    habits  = Habit.query.filter_by(is_active=True).all()
    logs    = {
        log.habit_id: log
        for log in HabitLog.query.filter_by(date=today).all()
    }
    result = []
    for h in habits:
        log  = logs.get(h.id)
        done = log.done if log else False
        result.append({**h.to_dict(), 'done': done, 'streak': get_streak(h.id)})
    return result


def toggle_habit(habit_id):
    """Toggle a habit done/undone for today. Returns new done state."""
    today = date.today()
    log   = HabitLog.query.filter_by(habit_id=habit_id, date=today).first()
    if log:
        log.done = not log.done
    else:
        log = HabitLog(habit_id=habit_id, date=today, done=True)
        db.session.add(log)
    db.session.commit()
    return log.done


def get_streak(habit_id):
    """Count consecutive days this habit was done up to today."""
    today  = date.today()
    streak = 0
    cursor = today
    while True:
        log = HabitLog.query.filter_by(habit_id=habit_id, date=cursor, done=True).first()
        if log:
            streak += 1
            cursor -= timedelta(days=1)
        else:
            break
    return streak


def get_completion_today():
    """Return (done_count, total_count, percentage) for today."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True).all()
    total  = len(habits)
    if total == 0:
        return 0, 0, 0
    done = HabitLog.query.filter_by(date=today, done=True)\
             .filter(HabitLog.habit_id.in_([h.id for h in habits])).count()
    pct  = round((done / total) * 100)
    return done, total, pct


def get_discipline_score(days=30):
    """
    Discipline score 0-100 based on last N days.
    Score = avg daily completion % over the period.
    """
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True).all()
    if not habits:
        return 0

    habit_ids = [h.id for h in habits]
    total_possible = len(habits) * days
    if total_possible == 0:
        return 0

    start = today - timedelta(days=days - 1)
    done_count = HabitLog.query.filter(
        HabitLog.habit_id.in_(habit_ids),
        HabitLog.date >= start,
        HabitLog.date <= today,
        HabitLog.done == True
    ).count()

    score = round((done_count / total_possible) * 100)
    return min(score, 100)


def get_weekly_stats():
    """Return list of 7 dicts (Mon–Sun) with completion % per day."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True).all()
    habit_ids = [h.id for h in habits]
    total  = len(habits)
    result = []

    # Go back to Monday
    start = today - timedelta(days=today.weekday())
    for i in range(7):
        d = start + timedelta(days=i)
        if total == 0:
            pct = 0
        else:
            done = HabitLog.query.filter(
                HabitLog.habit_id.in_(habit_ids),
                HabitLog.date == d,
                HabitLog.done == True
            ).count()
            pct = round((done / total) * 100)
        result.append({'date': d.isoformat(), 'pct': pct})
    return result


def get_monthly_stats():
    """Return daily completion % for last 30 days."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True).all()
    habit_ids = [h.id for h in habits]
    total  = len(habits)
    result = []

    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        if total == 0:
            pct = 0
        else:
            done = HabitLog.query.filter(
                HabitLog.habit_id.in_(habit_ids),
                HabitLog.date == d,
                HabitLog.done == True
            ).count()
            pct = round((done / total) * 100)
        result.append({'date': d.isoformat(), 'pct': pct})
    return result


def get_yearly_heatmap():
    """Return 365 days of completion data for heatmap."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True).all()
    habit_ids = [h.id for h in habits]
    total  = len(habits)
    result = []

    for i in range(364, -1, -1):
        d = today - timedelta(days=i)
        if total == 0:
            level = 0
        else:
            done = HabitLog.query.filter(
                HabitLog.habit_id.in_(habit_ids),
                HabitLog.date == d,
                HabitLog.done == True
            ).count()
            pct = (done / total) * 100
            if pct == 0:      level = 0
            elif pct < 34:    level = 1
            elif pct < 67:    level = 2
            elif pct < 100:   level = 3
            else:              level = 4
        result.append({'date': d.isoformat(), 'level': level})
    return result