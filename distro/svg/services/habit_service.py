"""
svg service: habit statistics & toggling.
Pure functions over Habit/HabitLog that compute streaks, today's completion, the
30-day discipline score, and the weekly/monthly/yearly views the API serves.
"""
from datetime import date, timedelta
from distro.svg.models.habit import Habit
from distro.svg.models.habit_log import HabitLog
from shared.extensions import db


def get_today_habits(user_id):
    """List a user's active habits, each with today's done flag and current streak."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True, user_id=user_id).all()
    logs   = {
        log.habit_id: log
        for log in HabitLog.query.filter_by(date=today).filter(
            HabitLog.habit_id.in_([h.id for h in habits])
        ).all()
    }
    result = []
    for h in habits:
        log  = logs.get(h.id)
        done = log.done if log else False
        result.append({**h.to_dict(), 'done': done, 'streak': get_streak(h.id)})
    return result


def toggle_habit(habit_id):
    """Flip today's done state for a habit (creating the log row if needed); return the new value."""
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
    """Count consecutive days up to today that this habit was marked done."""
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


def get_completion_today(user_id):
    """Return (done, total, pct) for the user's habits today."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True, user_id=user_id).all()
    total  = len(habits)
    if total == 0:
        return 0, 0, 0
    done = HabitLog.query.filter_by(date=today, done=True)\
             .filter(HabitLog.habit_id.in_([h.id for h in habits])).count()
    pct  = round((done / total) * 100)
    return done, total, pct


def get_discipline_score(user_id, days=30):
    """Percent of habit-days completed over the last `days` days (0–100)."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True, user_id=user_id).all()
    if not habits:
        return 0
    habit_ids      = [h.id for h in habits]
    total_possible = len(habits) * days
    start          = today - timedelta(days=days - 1)
    done_count     = HabitLog.query.filter(
        HabitLog.habit_id.in_(habit_ids),
        HabitLog.date >= start,
        HabitLog.date <= today,
        HabitLog.done == True
    ).count()
    return min(round((done_count / total_possible) * 100), 100)


def get_weekly_stats(user_id):
    """Per-day completion % for the current week (Mon–Sun)."""
    today     = date.today()
    habits    = Habit.query.filter_by(is_active=True, user_id=user_id).all()
    habit_ids = [h.id for h in habits]
    total     = len(habits)
    result    = []
    start     = today - timedelta(days=today.weekday())
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


def get_monthly_stats(user_id):
    """Per-day completion % for the last 30 days."""
    today     = date.today()
    habits    = Habit.query.filter_by(is_active=True, user_id=user_id).all()
    habit_ids = [h.id for h in habits]
    total     = len(habits)
    result    = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        done = 0 if total == 0 else HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date == d,
            HabitLog.done == True
        ).count()
        result.append({'date': d.isoformat(), 'pct': round((done / total) * 100) if total else 0})
    return result


def get_yearly_heatmap(user_id):
    """Per-day completion level (0–4) for the last 365 days (for the heatmap)."""
    today     = date.today()
    habits    = Habit.query.filter_by(is_active=True, user_id=user_id).all()
    habit_ids = [h.id for h in habits]
    total     = len(habits)
    result    = []
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
            level = 0 if pct == 0 else 1 if pct < 34 else 2 if pct < 67 else 3 if pct < 100 else 4
        result.append({'date': d.isoformat(), 'level': level})
    return result