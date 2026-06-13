"""
distro/svg/routes/community_route.py — svg's community (the `community_api` blueprint, prefix /api/community).

Endpoints for: the posts feed (with up/down votes + comments), a streak leaderboard, group
challenges, and image uploads (screened by an NSFW check in services/moderation.py).
This is svg's OWN community, separate from pug's.
"""
import os
import uuid
from flask import Blueprint, jsonify, request, session
from shared.extensions import db, limiter
from shared.auth.user import User
from distro.svg.models.habit import Habit
from distro.svg.models.habit_log import HabitLog
from distro.svg.models.community import CommunityPost, PostVote, PostComment, Challenge, ChallengeMember
from distro.pug.routes.notes import AmaMessage, Note   # Note = pug's post store (cross-distro feed)
from datetime import date, timedelta
import json as _json

community_api = Blueprint('community_api', __name__, url_prefix='/api/community')


def require_user():
    """Return the logged-in user id, or abort 401."""
    uid = session.get('user_id')
    if not uid:
        from flask import abort
        abort(401)
    return uid


def calc_streak(user_id):
    """Current consecutive-day streak for a user (any active habit done that day)."""
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
    """Users ranked by streak (scope=local for same distro, else global)."""
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
#  POSTS (Feed)
# ══════════════════════════════
def _pug_global_rows(user_id):
    """Pug's shared (g-flagged) posts, normalised into svg's post shape (source='pug').

    Pug stores posts as Note rows and uses like/dislike; we map its like-count to svg's
    single vote_count and a caller's like to 'voted'. Read directly (same DB). Pug media is
    skipped for now (its media endpoint is pug-gated).
    """
    posts = Note.query.filter(
        Note.entry_type == 'community_post', Note.is_deleted == False,
        Note.is_hidden.isnot(True), Note.mood.in_(['Ocellus', 'ThePug'])
    ).order_by(Note.created_at.desc()).limit(50).all()
    rows = []
    for p in posts:
        body, is_g = (p.body or ''), False
        if body.startswith('{'):
            try:
                bd = _json.loads(body); body = bd.get('t', ''); is_g = bool(bd.get('g'))
            except Exception:
                body = p.body or ''
        if not is_g:
            continue
        reacts = Note.query.filter_by(entry_type='post_react', mood=str(p.id), is_deleted=False).all()
        likes  = sum(1 for r in reacts if r.is_finished)
        voted  = any(r.user_id == user_id and r.is_finished for r in reacts)
        ccount = Note.query.filter_by(entry_type='post_comment', mood=str(p.id), is_deleted=False).count()
        author = User.query.get(p.user_id)
        rows.append({
            'id': p.id, 'title': '', 'body': body, 'image_url': None, 'tag': 'general',
            'vote_count': likes, 'voted': voted, 'comment_count': ccount,
            'author': author.username if author else '?', 'distro': p.mood or 'Ocellus',
            'created_at': p.created_at.isoformat() if p.created_at else '',
            'is_mine': p.user_id == user_id, 'source': 'pug',
        })
    return rows


@community_api.route('/posts', methods=['GET'])
def get_posts():
    """List community posts with vote/comment counts and the caller's own vote."""
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
            'image_url':     p.image_url,
            'tag':           p.tag,
            'vote_count':    p.vote_count,
            'voted':         voted,
            'comment_count': comment_count,
            'author':        p.author.username,
            'distro':        p.distro,
            'created_at':    p.created_at.isoformat(),
            'is_mine':       p.user_id == user_id,
            'source':        'post',
        })

    # ── Merge Pug AMA chat into GLOBAL feed (read-only) ──
    if scope == 'global' and page == 1:
        ama = AmaMessage.query.order_by(AmaMessage.created_at.desc()).limit(10).all()
        for a in ama:
            author = User.query.get(a.user_id)
            result.append({
                'id':            f'ama-{a.id}',
                'title':         '🐾 Pug AMA',
                'body':          a.body,
                'image_url':     None,
                'tag':           'ama',
                'vote_count':    0,
                'voted':         False,
                'comment_count': 0,
                'author':        (author.username if author else 'admin') if not a.is_admin else 'ThePug Admin',
                'distro':        'ThePug',
                'created_at':    a.created_at.isoformat(),
                'is_mine':       False,
                'source':        'ama',
            })
        # Merge pug's shared posts into the global feed (interactive — see /xpost/pug/*)
        result += _pug_global_rows(user_id)
        # re-sort merged feed by time
        result.sort(key=lambda x: x['created_at'], reverse=True)

    return jsonify(result)


@community_api.route('/posts', methods=['POST'])
@limiter.limit("10 per minute")
def create_post():
    """Create a new community post."""
    user_id = require_user()
    me      = User.query.get(user_id)
    data    = request.get_json()

    title     = (data.get('title') or '').strip()
    body      = (data.get('body')  or '').strip()
    tag       = data.get('tag', 'general')
    image_url = data.get('image_url')

    if not title or not body:
        return jsonify({'error': 'title and body required'}), 400
    if len(title) > 200:
        return jsonify({'error': 'title too long (max 200)'}), 400
    if len(body) > 2000:
        return jsonify({'error': 'body too long (max 2000)'}), 400
    if tag not in ['general', 'question', 'motivation', 'win', 'challenge']:
        tag = 'general'

    post = CommunityPost(
        user_id   = user_id,
        distro    = me.distro,
        title     = title,
        body      = body,
        tag       = tag,
        image_url = image_url,
        is_global = bool(data.get('is_global')),   # share into the all-distros feed?
    )
    db.session.add(post)
    db.session.commit()
    return jsonify({'id': post.id}), 201


@community_api.route('/posts/<int:post_id>', methods=['DELETE'])
def delete_post(post_id):
    """Delete the caller's own post."""
    user_id = require_user()
    post    = CommunityPost.query.filter_by(id=post_id, user_id=user_id).first_or_404()
    db.session.delete(post)
    db.session.commit()
    return jsonify({'success': True})


@community_api.route('/posts/<int:post_id>/vote', methods=['POST'])
@limiter.limit("30 per minute")
def vote_post(post_id):
    """Up/down vote a post (toggles the caller's vote)."""
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
    """List a post's comments."""
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
    """Add a comment to a post."""
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
#  CROSS-DISTRO — act on a PUG post from svg's feed (writes to pug's Note store)
#  svg has a single up-vote, so a vote toggles a pug 'like'.
# ══════════════════════════════
def _pug_post(pid):
    """The pug community-post Note #pid if it exists (and isn't deleted/hidden), else None."""
    return Note.query.filter(Note.id == pid, Note.entry_type == 'community_post',
                             Note.is_deleted == False, Note.is_hidden.isnot(True)).first()


@community_api.route('/xpost/pug/<int:pid>/vote', methods=['POST'])
@limiter.limit("30 per minute")
def xvote_pug(pid):
    """svg user votes a pug post → toggles a 'like' in pug's reaction store."""
    user_id = require_user()
    if not _pug_post(pid):
        return jsonify({'error': 'Not found'}), 404
    existing = Note.query.filter_by(user_id=user_id, entry_type='post_react',
                                    mood=str(pid), is_deleted=False).first()
    if existing:
        existing.is_deleted = True          # un-vote (remove the like)
        voted = False
    else:
        db.session.add(Note(user_id=user_id, entry_type='post_react', is_deleted=False,
                            mood=str(pid), is_finished=True))
        voted = True
    db.session.commit()
    likes = Note.query.filter_by(entry_type='post_react', mood=str(pid),
                                 is_deleted=False, is_finished=True).count()
    return jsonify({'vote_count': likes, 'voted': voted})


@community_api.route('/xpost/pug/<int:pid>/comments', methods=['GET'])
def xcomments_pug(pid):
    """List a pug post's comments in svg's comment shape."""
    require_user()
    rows = Note.query.filter_by(entry_type='post_comment', mood=str(pid),
                                is_deleted=False).order_by(Note.created_at.asc()).limit(50).all()
    umap = {u.id: u for u in User.query.filter(User.id.in_({c.user_id for c in rows})).all()} if rows else {}
    return jsonify([{
        'id': c.id, 'body': c.body,
        'author': (umap.get(c.user_id).username if umap.get(c.user_id) else '?'),
        'created_at': c.created_at.isoformat() if c.created_at else None,
    } for c in rows])


@community_api.route('/xpost/pug/<int:pid>/comments', methods=['POST'])
@limiter.limit("20 per minute")
def xcomment_pug(pid):
    """svg user comments on a pug post → writes a comment into pug's Note store."""
    user_id = require_user()
    if not _pug_post(pid):
        return jsonify({'error': 'Not found'}), 404
    body = ((request.get_json(silent=True) or {}).get('body') or '').strip()
    if not body or len(body) > 500:
        return jsonify({'error': 'comment required (max 500 chars)'}), 400
    c = Note(user_id=user_id, entry_type='post_comment', is_deleted=False, mood=str(pid))
    c.body = body
    db.session.add(c)
    db.session.commit()
    return jsonify({'id': c.id}), 201


# ══════════════════════════════
#  IMAGE UPLOAD (with NSFW check)
# ══════════════════════════════
@community_api.route('/upload-image', methods=['POST'])
@limiter.limit("10 per minute")
def upload_image():
    """Upload a post image after an NSFW check; returns its stored URL."""
    user_id = require_user()

    if 'image' not in request.files:
        return jsonify({'error': 'no image provided'}), 400

    file = request.files['image']
    if not file or not file.filename:
        return jsonify({'error': 'no image provided'}), 400

    allowed_ext = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_ext:
        return jsonify({'error': 'unsupported file type (jpg, png, webp, gif only)'}), 400

    file_bytes = file.read()
    if len(file_bytes) > 8 * 1024 * 1024:  # 8 MB
        return jsonify({'error': 'image too large (max 8MB)'}), 400

    # ── NSFW moderation ──
    from distro.svg.services.moderation import check_image_safe
    is_safe, reason = check_image_safe(file_bytes)
    if not is_safe:
        return jsonify({'error': f'image rejected by content filter: {reason}'}), 422

    # ── Upload to MinIO ──
    try:
        from minio import Minio
        client = Minio(
            os.environ.get('MINIO_ENDPOINT'),
            access_key=os.environ.get('MINIO_ACCESS_KEY'),
            secret_key=os.environ.get('MINIO_SECRET_KEY'),
            secure=True,
        )
        bucket = os.environ.get('MINIO_BUCKET')
        key    = f'community/{user_id}/{uuid.uuid4().hex}{ext}'

        import io as _io
        client.put_object(
            bucket, key, _io.BytesIO(file_bytes), length=len(file_bytes),
            content_type=file.mimetype,
        )

        endpoint = os.environ.get('MINIO_ENDPOINT')
        url = f'https://{endpoint}/{bucket}/{key}'
        return jsonify({'url': url}), 201

    except Exception as e:
        return jsonify({'error': f'upload failed: {e}'}), 500


# ══════════════════════════════
#  CHALLENGES
# ══════════════════════════════
@community_api.route('/challenges', methods=['GET'])
def get_challenges():
    """List challenges the user can see / join."""
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
    """Create a group habit challenge."""
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
    """Join a challenge."""
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