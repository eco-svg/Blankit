"""
distro/svg/routes/api_route.py — svg's main data API (the `api` blueprint, prefix /api).

The JSON endpoints svg's pages call to read/write habits, to-dos, stats, badges, and
streaks. Most business logic lives in services/ (habit_service, badge_service); these
routes are thin wrappers that check login and hand off to those services.
"""
import os
from flask import Blueprint, jsonify, request, session, current_app
from datetime import date
from shared.extensions import db
from distro.svg.models.habit import Habit
from distro.svg.models.habit_log import HabitLog
from distro.svg.models.todo import Todo
from distro.svg.models.donation import Donation
from distro.svg.services import habit_service, badge_service
from datetime import date, timedelta
from shared.extensions import limiter



api = Blueprint('api', __name__, url_prefix='/api')


def current_user_id():
    """The logged-in user's id, or None if nobody is logged in."""
    uid = session.get('user_id')
    if not uid:
        return None
    return uid


def require_user():
    """Return the logged-in user's id, or abort with 401 if not logged in."""
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
    """Return the user's habits with today's done/streak status."""
    user_id = require_user()
    return jsonify(habit_service.get_today_habits(user_id))


@api.route('/habits', methods=['POST'])
@limiter.limit("30 per minute")
def add_habit():
    """Create a new habit for the user."""
    user_id = require_user()
    data    = request.get_json()
    name    = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if len(name) > 120:
        return jsonify({'error': 'Name too long (max 120 chars)'}), 400

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
    """Soft-delete a habit (mark it inactive)."""
    user_id = require_user()
    habit   = Habit.query.filter_by(id=habit_id, user_id=user_id).first_or_404()
    habit.is_active = False
    db.session.commit()
    return jsonify({'success': True})


@api.route('/habits/<int:habit_id>/toggle', methods=['POST'])
def toggle_habit(habit_id):
    """Toggle today's completion for a habit; return updated %, discipline score, and any newly unlocked badges."""
    user_id = require_user()
    # verify habit belongs to user
    Habit.query.filter_by(id=habit_id, user_id=user_id).first_or_404()
    done       = habit_service.toggle_habit(habit_id)
    new_badges = badge_service.check_and_unlock(habit_id, user_id)
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
    """Today's completion count, percentage, and discipline score."""
    user_id      = require_user()
    done, total, pct = habit_service.get_completion_today(user_id)
    score        = habit_service.get_discipline_score(user_id)
    return jsonify({'done': done, 'total': total, 'completion_pct': pct, 'discipline': score})


@api.route('/stats/weekly', methods=['GET'])
def stats_weekly():
    """Weekly completion stats."""
    return jsonify(habit_service.get_weekly_stats(require_user()))


@api.route('/stats/monthly', methods=['GET'])
def stats_monthly():
    """Monthly completion stats."""
    return jsonify(habit_service.get_monthly_stats(require_user()))


@api.route('/stats/yearly', methods=['GET'])
def stats_yearly():
    """Year-long completion heatmap."""
    return jsonify(habit_service.get_yearly_heatmap(require_user()))


# ══════════════════════════════
#  TODOS
# ══════════════════════════════

@api.route('/todos/<string:date_str>', methods=['GET'])
def get_todos(date_str):
    """List the user's to-dos for a given date (YYYY-MM-DD)."""
    user_id = require_user()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    todos = Todo.query.filter_by(date=d, user_id=user_id).order_by(Todo.created_at).all()
    return jsonify([t.to_dict() for t in todos])


@api.route('/todos/<string:date_str>', methods=['POST'])
def add_todo(date_str):
    """Add a to-do on a given date."""
    user_id = require_user()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400
    data = request.get_json()
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Text is required'}), 400
    if len(text) > 300:
        return jsonify({'error': 'Text too long (max 300 chars)'}), 400
    todo = Todo(text=text, date=d, priority=data.get('priority', 'medium'), user_id=user_id)
    db.session.add(todo)
    db.session.commit()
    return jsonify(todo.to_dict()), 201


@api.route('/todos/item/<int:todo_id>/toggle', methods=['POST'])
def toggle_todo(todo_id):
    """Flip a to-do's done state."""
    user_id   = require_user()
    todo      = Todo.query.filter_by(id=todo_id, user_id=user_id).first_or_404()
    todo.done = not todo.done
    db.session.commit()
    return jsonify(todo.to_dict())


@api.route('/todos/item/<int:todo_id>', methods=['DELETE'])
def delete_todo(todo_id):
    """Delete a to-do."""
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
    """Every badge with this user's earned/locked status."""
    user_id = require_user()
    return jsonify(badge_service.get_all_badges_with_status(user_id))


@api.route('/badges/<int:badge_id>/podium', methods=['POST'])
def set_podium(badge_id):
    """Pin an earned badge to a podium slot (rank 1/2/3)."""
    user_id = require_user()
    data = request.get_json()
    rank = data.get('rank')
    if rank not in [1, 2, 3]:
        return jsonify({'error': 'Rank must be 1, 2 or 3'}), 400
    success = badge_service.set_podium_rank(badge_id, rank, user_id)
    if not success:
        return jsonify({'error': 'Badge not earned yet'}), 400
    return jsonify({'success': True})


@api.route('/streak', methods=['GET'])
def get_streak():
    """Compute the current consecutive-day completion streak (any habit done that day)."""
    user_id = session.get('user_id')
    user_id = require_user()

    habits = Habit.query.filter_by(user_id=user_id).all()
    if not habits:
        return jsonify({'streak': 0})

    habit_ids = [h.id for h in habits]
    streak     = 0
    check_date = date.today()

    while True:
        completed = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date == check_date,
            HabitLog.done == True
        ).first()
        if completed:
            streak     += 1
            check_date -= timedelta(days=1)
        else:
            break

    return jsonify({'streak': streak})


# ══════════════════════════════
#  SUPPORT DONATIONS (Razorpay)
# ══════════════════════════════
# svg donations flow through the SHARED (owner's) Razorpay account — same keys as the
# rest of the app. Every order is tagged distro=Eco-Svg in Razorpay's notes AND stored
# in the donations table, so the owner can reconcile what to forward to the partner.
# Signature verification (HMAC over order_id|payment_id with the key secret) is what
# proves a donation genuinely completed — a client cannot forge it.

def _razorpay_keys():
    return (os.environ.get('RAZORPAY_KEY_ID'), os.environ.get('RAZORPAY_KEY_SECRET'))


def _verify_donation_signature(order_id, payment_id, signature, secret):
    import hmac, hashlib
    expected = hmac.new(secret.encode(), f'{order_id}|{payment_id}'.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or '')


def _credit_donation(order_id, payment_id):
    """Idempotently mark a donation paid for a given Razorpay order. Safe to call from
    BOTH the client verify call AND the shared payment webhook (pug_route.py falls
    through to this when an order isn't a wallet top-up) — the row is locked FOR UPDATE
    and only a still-'created' donation is updated, so repeats are no-ops. Returns False
    if no donation matches this order (e.g. it belongs to a wallet top-up instead)."""
    d = Donation.query.filter_by(razorpay_order_id=order_id).with_for_update().first()
    if not d:
        return False
    if d.status != 'paid':
        d.status = 'paid'
        d.razorpay_payment_id = payment_id
    db.session.commit()   # also releases the row lock when already paid
    return True


@api.route('/donate/order', methods=['POST'])
def donate_order():
    """Create a Razorpay order for a support donation. The amount is validated + priced
    server-side (rupees → paise); the client only proposes how much to give."""
    uid = require_user()
    key_id, key_secret = _razorpay_keys()
    if not (key_id and key_secret):
        return jsonify({'error': 'Online payment is not available right now.'}), 503
    body   = request.get_json(silent=True) or {}
    amount = body.get('amount')                       # rupees
    if not isinstance(amount, int) or amount < 1:
        return jsonify({'error': 'Enter a valid amount.'}), 400
    if amount > 100000:
        return jsonify({'error': 'Maximum ₹1,00,000 per donation.'}), 400
    paise = amount * 100

    import requests as req
    from datetime import datetime as _dt
    receipt = f'svgdon_{uid}_{int(_dt.utcnow().timestamp())}'
    try:
        resp = req.post('https://api.razorpay.com/v1/orders',
                        auth=(key_id, key_secret),
                        json={'amount': paise, 'currency': 'INR', 'receipt': receipt,
                              'notes': {'distro': 'Eco-Svg', 'purpose': 'donation', 'user_id': str(uid)}},
                        timeout=15)
    except req.RequestException:
        return jsonify({'error': 'Payment service unreachable — please try again.'}), 502
    if resp.status_code not in (200, 201):
        current_app.logger.warning('svg donate order failed %s: %s', resp.status_code, resp.text[:300])
        return jsonify({'error': 'Could not start payment — please try again.'}), 502

    order = resp.json()
    order_id = order.get('id')
    if not order_id:
        return jsonify({'error': 'Could not start payment — please try again.'}), 502
    db.session.add(Donation(user_id=uid, distro='Eco-Svg', amount_paise=paise,
                            razorpay_order_id=order_id, status='created'))
    db.session.commit()
    return jsonify({'ok': True, 'order_id': order_id, 'amount': paise, 'currency': 'INR',
                    'key_id': key_id, 'name': 'VEYRA — Support', 'description': f'Donation ₹{amount}'})


@api.route('/donate/verify', methods=['POST'])
def donate_verify():
    """Verify the signed payment and mark the donation paid."""
    uid = require_user()
    _, key_secret = _razorpay_keys()
    if not key_secret:
        return jsonify({'error': 'Online payment is not available right now.'}), 503
    body       = request.get_json(silent=True) or {}
    order_id   = body.get('razorpay_order_id')
    payment_id = body.get('razorpay_payment_id')
    signature  = body.get('razorpay_signature')
    if not (order_id and payment_id and signature):
        return jsonify({'error': 'Missing payment details'}), 400
    if not _verify_donation_signature(order_id, payment_id, signature, key_secret):
        return jsonify({'error': 'Payment could not be verified'}), 400
    # Make sure this order belongs to the logged-in user before crediting (mirrors the
    # same ownership check on pug's wallet verify) — defense in depth alongside the
    # signature check, which already proves the payment itself is genuine.
    owned = Donation.query.filter_by(razorpay_order_id=order_id, user_id=uid).first()
    if not owned:
        return jsonify({'error': 'Donation not found'}), 404
    _credit_donation(order_id, payment_id)
    return jsonify({'ok': True})

