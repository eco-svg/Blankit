from flask import Blueprint, jsonify, request, session
from shared.extensions import db, limiter
from shared.auth.user import User
from distro.svg.models.habit import Habit
from distro.svg.models.habit_log import HabitLog
from distro.svg.models.community import CommunityPost, PostVote, PostComment, Challenge, ChallengeMember
from datetime import date, timedelta

community_api = Blueprint('community_api', __name__, url_prefix='/api/community')


def require_user():
    uid = session.get('user_id')
    if not uid:
        from flask import abort
        abort(401)
    return uid


def calc_streak(user_id):
    habits = Habit.query.filter_by(user_id=user_id, is_active=True).all()
    if not habits:
        return 0
    habit_ids = [h.id for h in habits]
    streak = 0
    check_date = date.today()
    while True:
        done = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date == check_date,
            HabitLog.done == True
        ).first()
        if done:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break
    return streak


# ══════════════════════════════
#  LEADERBOARD
# ══════════════════════════════
@community_api.route('/leaderboard', methods=['GET'])
def leaderboard():
    user_id = require_user()
    scope   = request.args.get('scope', 'local')
    me      = User.query.get(user_id)

    if scope == 'local':
        users = User.query.filter_by(distro=me.distro, is_verified=True).all()
    else:
        users = User.query.filter_by(is_verified=True).all()

    board = []
    for u in users:
        streak = calc_streak(u.id)
        habits_today = HabitLog.query.join(Habit).filter(
            Habit.user_id == u.id,
            HabitLog.date == date.today(),
            HabitLog.done == True
        ).count()
        board.append({
            'id':           u.id,
            'username':     u.username,
            'distro':       u.distro,
            'streak':       streak,
            'habits_today': habits_today,
            'is_you':       u.id == user_id,
        })

    board.sort(key=lambda x: (x['streak'], x['habits_today']), reverse=True)
    return jsonify(board[:20])


# ══════════════════════════════
#  POSTS
# ══════════════════════════════
@community_api.route('/posts', methods=['GET'])
def get_posts():
    user_id = require_user()
    scope   = request.args.get('scope', 'local')
    page    = max(1, int(request.args.get('page', 1)))
    me      = User.query.get(user_id)

    q = CommunityPost.query
    if scope == 'local':
        q = q.filter_by(distro=me.distro)

    posts = q.order_by(CommunityPost.created_at.desc()).offset((page - 1) * 20).limit(20).all()

    result = []
    for p in posts:
        voted         = PostVote.query.filter_by(user_id=user_id, post_id=p.id).first() is not None
        comment_count = PostComment.query.filter_by(post_id=p.id).count()
        result.append({
            'id':            p.id,
            'title':         p.title,
            'body':          p.body,
            'tag':           p.tag,
            'vote_count':    p.vote_count,
            'voted':         voted,
            'comment_count': comment_count,
            'author':        p.author.username,
            'distro':        p.distro,
            'created_at':    p.created_at.isoformat(),
            'is_mine':       p.user_id == user_id,
        })
    return jsonify(result)


@community_api.route('/posts', methods=['POST'])
@limiter.limit("10 per minute")
def create_post():
    user_id = require_user()
    me      = User.query.get(user_id)
    data    = request.get_json()

    title = (data.get('title') or '').strip()
    body  = (data.get('body')  or '').strip()
    tag   = data.get('tag', 'general')

    if not title or not body:
        return jsonify({'error': 'title and body required'}), 400
    if len(title) > 200:
        return jsonify({'error': 'title too long (max 200)'}), 400
    if len(body) > 2000:
        return jsonify({'error': 'body too long (max 2000)'}), 400
    if tag not in ['general', 'question', 'motivation', 'win', 'challenge']:
        tag = 'general'

    post = CommunityPost(user_id=user_id, distro=me.distro, title=title, body=body, tag=tag)
    db.session.add(post)
    db.session.commit()
    return jsonify({'id': post.id}), 201


@community_api.route('/posts/<int:post_id>', methods=['DELETE'])
def delete_post(post_id):
    user_id = require_user()
    post    = CommunityPost.query.filter_by(id=post_id, user_id=user_id).first_or_404()
    db.session.delete(post)
    db.session.commit()
    return jsonify({'success': True})


@community_api.route('/posts/<int:post_id>/vote', methods=['POST'])
@limiter.limit("30 per minute")
def vote_post(post_id):
    user_id  = require_user()
    post     = CommunityPost.query.get_or_404(post_id)
    existing = PostVote.query.filter_by(user_id=user_id, post_id=post_id).first()

    if existing:
        db.session.delete(existing)
        post.vote_count = max(0, post.vote_count - 1)
        voted = False
    else:
        db.session.add(PostVote(user_id=user_id, post_id=post_id))
        post.vote_count += 1
        voted = True

    db.session.commit()
    return jsonify({'vote_count': post.vote_count, 'voted': voted})


@community_api.route('/posts/<int:post_id>/comments', methods=['GET'])
def get_comments(post_id):
    require_user()
    comments = PostComment.query.filter_by(post_id=post_id).order_by(PostComment.created_at).all()
    return jsonify([{
        'id':         c.id,
        'body':       c.body,
        'author':     c.author.username,
        'created_at': c.created_at.isoformat(),
    } for c in comments])


@community_api.route('/posts/<int:post_id>/comments', methods=['POST'])
@limiter.limit("20 per minute")
def add_comment(post_id):
    user_id = require_user()
    CommunityPost.query.get_or_404(post_id)
    data = request.get_json()
    body = (data.get('body') or '').strip()
    if not body or len(body) > 500:
        return jsonify({'error': 'comment required (max 500 chars)'}), 400
    comment = PostComment(post_id=post_id, user_id=user_id, body=body)
    db.session.add(comment)
    db.session.commit()
    return jsonify({'id': comment.id}), 201


# ══════════════════════════════
#  CHALLENGES
# ══════════════════════════════
@community_api.route('/challenges', methods=['GET'])
def get_challenges():
    user_id = require_user()
    scope   = request.args.get('scope', 'local')
    me      = User.query.get(user_id)

    q = Challenge.query
    if scope == 'local':
        q = q.filter_by(distro=me.distro)

    challenges = q.order_by(Challenge.created_at.desc()).limit(20).all()
    result = []
    for c in challenges:
        member_count = ChallengeMember.query.filter_by(challenge_id=c.id).count()
        joined       = ChallengeMember.query.filter_by(challenge_id=c.id, user_id=user_id).first() is not None
        result.append({
            'id':            c.id,
            'title':         c.title,
            'habit_name':    c.habit_name,
            'duration_days': c.duration_days,
            'member_count':  member_count,
            'joined':        joined,
            'creator':       c.creator.username,
            'distro':        c.distro,
            'created_at':    c.created_at.isoformat(),
            'is_mine':       c.creator_id == user_id,
        })
    return jsonify(result)


@community_api.route('/challenges', methods=['POST'])
@limiter.limit("5 per minute")
def create_challenge():
    user_id = require_user()
    me      = User.query.get(user_id)
    data    = request.get_json()

    title      = (data.get('title')      or '').strip()
    habit_name = (data.get('habit_name') or '').strip()
    duration   = int(data.get('duration_days', 30))
    scope      = data.get('scope', 'local')

    if not title or not habit_name:
        return jsonify({'error': 'title and habit_name required'}), 400
    if duration not in [7, 14, 21, 30, 60, 90]:
        duration = 30

    challenge = Challenge(
        creator_id    = user_id,
        distro        = me.distro if scope == 'local' else 'global',
        scope         = scope,
        title         = title,
        habit_name    = habit_name,
        duration_days = duration,
    )
    db.session.add(challenge)
    db.session.commit()
    db.session.add(ChallengeMember(challenge_id=challenge.id, user_id=user_id))
    db.session.commit()
    return jsonify({'id': challenge.id}), 201


@community_api.route('/challenges/<int:challenge_id>/join', methods=['POST'])
@limiter.limit("20 per minute")
def join_challenge(challenge_id):
    user_id  = require_user()
    Challenge.query.get_or_404(challenge_id)
    existing = ChallengeMember.query.filter_by(challenge_id=challenge_id, user_id=user_id).first()

    if existing:
        db.session.delete(existing)
        db.session.commit()
        return jsonify({'joined': False})

    db.session.add(ChallengeMember(challenge_id=challenge_id, user_id=user_id))
    db.session.commit()
    return jsonify({'joined': True})