"""
svg service: badge gamification.
Seeds the master badge list, evaluates each badge's unlock condition after a habit
toggle, and manages the user's earned badges + podium picks.
"""
from datetime import date, timedelta
from shared.extensions import db
from distro.svg.models.badge import Badge, UserBadge, BADGE_DEFINITIONS
from distro.svg.models.habit_log import HabitLog
from distro.svg.models.habit import Habit
from distro.svg.services.habit_service import get_streak, get_discipline_score


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


def check_and_unlock(habit_id, user_id):
    """
    Run after every habit toggle.
    Checks all badge conditions for this user and unlocks any newly earned ones.
    Returns list of newly unlocked badge dicts.
    """
    if not user_id:
        return []

    newly_earned = []
    all_badges   = Badge.query.all()
    earned_ids   = {ub.badge_id for ub in UserBadge.query.filter_by(user_id=user_id).all()}

    for badge in all_badges:
        if badge.id in earned_ids:
            continue
        if _check_condition(badge.condition, habit_id, user_id):
            ub = UserBadge(badge_id=badge.id, user_id=user_id)
            db.session.add(ub)
            newly_earned.append(badge.to_dict(earned=True))

    db.session.commit()
    return newly_earned


def _check_condition(condition, habit_id, user_id):
    """Return True if the badge condition is met for this user."""
    today  = date.today()
    habits = Habit.query.filter_by(is_active=True, user_id=user_id).all() if user_id else []

    # ── streak conditions ──────────────────────────────────────────
    if condition.startswith('streak_'):
        days = int(condition.split('_')[1])
        return any(get_streak(h.id) >= days for h in habits)

    # ── first week ever ────────────────────────────────────────────
    if condition == 'first_week':
        return any(get_streak(h.id) >= 7 for h in habits)

    # ── single habit N consecutive days ───────────────────────────
    if condition.startswith('habit_'):
        days = int(condition.split('_')[1])
        return any(get_streak(h.id) >= days for h in habits)

    # ── perfect week (100% every day this week) ────────────────────
    if condition == 'perfect_week':
        if not habits:
            return False
        habit_ids = [h.id for h in habits]
        total     = len(habits)
        start     = today - timedelta(days=today.weekday())
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
        if not habits:
            return False
        habit_ids  = [h.id for h in habits]
        night_days = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            db.extract('hour', HabitLog.logged_at) >= 22,
            HabitLog.done == True
        ).distinct(HabitLog.date).count()
        return night_days >= 7

    return False


def get_all_badges_with_status(user_id):
    """Return all badges with earned=True/False and podium rank for this user."""
    badges      = Badge.query.all()
    user_badges = {ub.badge_id: ub for ub in UserBadge.query.filter_by(user_id=user_id).all()}
    return [
        b.to_dict(
            earned    = b.id in user_badges,
            earned_at = user_badges[b.id].earned_at if b.id in user_badges else None,
            rank      = user_badges[b.id].podium_rank if b.id in user_badges else None,
        )
        for b in badges
    ]


def set_podium_rank(badge_id, rank, user_id):
    """Assign a podium rank (1/2/3) to an earned badge for this user."""
    existing = UserBadge.query.filter_by(podium_rank=rank, user_id=user_id).first()
    if existing:
        existing.podium_rank = None

    ub = UserBadge.query.filter_by(badge_id=badge_id, user_id=user_id).first()
    if ub:
        ub.podium_rank = rank
        db.session.commit()
        return True
    return False
