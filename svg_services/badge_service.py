from datetime import date, timedelta
from svg_models import db
from svg_models.badge import Badge, UserBadge, BADGE_DEFINITIONS
from svg_models.habit_log import HabitLog
from svg_models.habit import Habit
from svg_services.habit_service import get_streak, get_discipline_score


def seed_badges():
    """Insert badge definitions into DB if not already there."""
    for b in BADGE_DEFINITIONS:
        if not Badge.query.filter_by(key=b['key']).first():
            db.session.add(Badge(
                key=b['key'], name=b['name'],
                icon=b['icon'], desc=b['desc'],
                condition=b['condition']
            ))
    db.session.commit()


def check_and_unlock(habit_id=None):
    """
    Run after every habit toggle.
    Check all badge conditions and unlock any newly earned ones.
    Returns list of newly unlocked badge dicts.
    """
    newly_earned = []
    all_badges   = Badge.query.all()
    earned_ids   = {ub.badge_id for ub in UserBadge.query.all()}

    for badge in all_badges:
        if badge.id in earned_ids:
            continue  # already earned

        earned = _check_condition(badge.condition, habit_id)
        if earned:
            ub = UserBadge(badge_id=badge.id)
            db.session.add(ub)
            newly_earned.append(badge.to_dict(earned=True))

    db.session.commit()
    return newly_earned


def _check_condition(condition, habit_id=None):
    """Return True if the badge condition is met."""
    today   = date.today()
    habits  = Habit.query.filter_by(is_active=True).all()

    # ── streak conditions ──────────────────────────────────────────
    if condition.startswith('streak_'):
        days = int(condition.split('_')[1])
        # check if ANY habit has a streak >= days
        for h in habits:
            if get_streak(h.id) >= days:
                return True
        return False

    # ── first week ever ────────────────────────────────────────────
    if condition == 'first_week':
        for h in habits:
            if get_streak(h.id) >= 7:
                return True
        return False

    # ── single habit N consecutive days ───────────────────────────
    if condition.startswith('habit_'):
        days = int(condition.split('_')[1])
        for h in habits:
            if get_streak(h.id) >= days:
                return True
        return False

    # ── perfect week (100% every day this week) ────────────────────
    if condition == 'perfect_week':
        habit_ids = [h.id for h in habits]
        total     = len(habits)
        if total == 0:
            return False
        start = today - timedelta(days=today.weekday())
        for i in range(7):
            d = start + timedelta(days=i)
            if d > today:
                break
            done = HabitLog.query.filter(
                HabitLog.habit_id.in_(habit_ids),
                HabitLog.date == d,
                HabitLog.done == True
            ).count()
            if done < total:
                return False
        return True

    # ── night logging (logged after 10pm for 7 days) ───────────────
    if condition == 'night_7':
        from datetime import datetime
        night_days = HabitLog.query.filter(
            db.extract('hour', HabitLog.logged_at) >= 22,
            HabitLog.done == True
        ).distinct(HabitLog.date).count()
        return night_days >= 7

    return False


def get_all_badges_with_status():
    """Return all badges with earned=True/False and podium rank."""
    badges     = Badge.query.all()
    user_badges = {ub.badge_id: ub for ub in UserBadge.query.all()}
    result = []
    for b in badges:
        ub = user_badges.get(b.id)
        result.append(b.to_dict(
            earned    = ub is not None,
            earned_at = ub.earned_at if ub else None,
            rank      = ub.podium_rank if ub else None,
        ))
    return result


def set_podium_rank(badge_id, rank):
    """Assign a podium rank (1/2/3) to an earned badge."""
    # clear existing badge at that rank
    existing = UserBadge.query.filter_by(podium_rank=rank).first()
    if existing:
        existing.podium_rank = None

    ub = UserBadge.query.filter_by(badge_id=badge_id).first()
    if ub:
        ub.podium_rank = rank
        db.session.commit()
        return True
    return False