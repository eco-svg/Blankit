"""Community: feed, posts, reactions, comments, pins, action buttons."""
import json
from datetime import datetime, timedelta

from flask import jsonify, request, session, url_for
from sqlalchemy import func as sqlfunc

from shared.extensions import db, limiter
from distro.pug.models import Note, pack_post_body, unpack_post_body
from . import pug_bp
from .guards import login_required
from .helpers import (award_exp, haversine_km, is_online, net_rank_for_user,
                      post_skill_tag, user_has_skill, user_location)

VALID_POST_TYPES = {'blog', 'showoff', 'buy', 'hire', 'learn', 'collab', 'sell', 'teach'}
FEED_DISTROS     = ['Ocellus', 'ThePug']  # legacy rows carry the old distro name

_ACTION_EXP_MAP = {
    'hire':   'purchase_hire',
    'buy':    'purchase_hire',
    'collab': 'collab_request',
    'learn':  'collab_request',
}


def _users_by_id(ids):
    from shared.auth.user import User
    if not ids:
        return {}
    return {u.id: u for u in User.query.filter(User.id.in_(list(set(ids)))).all()}


def _post_row(p, u, me, dist_km=None):
    rank, color = net_rank_for_user(p.user_id)
    b = unpack_post_body(p.body or '')
    media_url = url_for('pug.serve_media_shared', object_name=b['media_key']) if b['media_key'] else None
    return {
        'id':          p.id,
        'text':        b['text'],
        'media_key':   b['media_key'],
        'media_url':   media_url,
        'post_type':   b['post_type'],
        'pinned_cid':  b['pinned_cid'],
        'text_order':  b['text_order'],
        'skill_tag':   b['skill_tag'],
        'username':    u.username,
        'user_id':     p.user_id,
        'distro':      p.mood or 'Ocellus',
        'rank':        rank,
        'rank_color':  color,
        'is_mine':     p.user_id == me,
        'is_online':   is_online(u),
        'created_at':  p.created_at.isoformat() if p.created_at else None,
        'dist_km':     round(dist_km, 1) if dist_km is not None else None,
    }


def _enrich(posts_list, me):
    """Attach like/dislike counts, my reaction, and comment counts."""
    if not posts_list:
        return posts_list
    pids = [str(r['id']) for r in posts_list]
    reacts = Note.query.filter(
        Note.entry_type == 'post_react',
        Note.mood.in_(pids),
        Note.is_deleted == False
    ).all()
    rm = {}
    for r in reacts:
        rm.setdefault(r.mood, {'likes': 0, 'dislikes': 0, 'my_reaction': None})
        if r.is_finished:
            rm[r.mood]['likes'] += 1
        else:
            rm[r.mood]['dislikes'] += 1
        if r.user_id == me:
            rm[r.mood]['my_reaction'] = 'like' if r.is_finished else 'dislike'
    cc = db.session.query(Note.mood, sqlfunc.count(Note.id)).filter(
        Note.entry_type == 'post_comment',
        Note.mood.in_(pids),
        Note.is_deleted == False
    ).group_by(Note.mood).all()
    cmap = {pid_s: cnt for pid_s, cnt in cc}
    for row in posts_list:
        d = rm.get(str(row['id']), {})
        row['likes']         = d.get('likes', 0)
        row['dislikes']      = d.get('dislikes', 0)
        row['my_reaction']   = d.get('my_reaction')
        row['comment_count'] = cmap.get(str(row['id']), 0)
    return posts_list


@pug_bp.route('/pug/api/community', methods=['GET'])
@login_required
def get_community_feed():
    me = session['user_id']

    try:
        my_lat = float(request.args['lat'])
        my_lng = float(request.args['lng'])
        use_location = True
    except (KeyError, ValueError):
        use_location = False

    skill_filter = (request.args.get('skill') or '').strip().lower()
    user_filter  = request.args.get('user_id', type=int)

    q = Note.query.filter(Note.entry_type == 'community_post',
                          Note.is_deleted == False,
                          Note.mood.in_(FEED_DISTROS))
    if user_filter:
        q = q.filter_by(user_id=user_filter)
    posts = q.order_by(Note.created_at.desc()).limit(200).all()
    users = _users_by_id([p.user_id for p in posts])

    if use_location and not user_filter:
        # Expand the radius until the feed has enough posts
        for radius_km in (50, 100, 250, None):
            result = []
            for p in posts:
                u = users.get(p.user_id)
                if not u:
                    continue
                plat, plng = user_location(p.user_id)
                dist = haversine_km(my_lat, my_lng, plat, plng) if plat is not None else None
                if radius_km is not None and (dist is None or dist > radius_km):
                    continue
                if skill_filter and not user_has_skill(p.user_id, skill_filter):
                    continue
                result.append(_post_row(p, u, me, dist_km=dist))
            if len(result) >= 5 or radius_km is None:
                return jsonify({'posts': _enrich(result, me), 'radius_km': radius_km})
        return jsonify({'posts': [], 'radius_km': None})

    result = []
    for p in posts:
        u = users.get(p.user_id)
        if not u:
            continue
        if skill_filter and not user_has_skill(p.user_id, skill_filter):
            continue
        result.append(_post_row(p, u, me))
    return jsonify({'posts': _enrich(result, me), 'radius_km': None})


@pug_bp.route('/pug/api/community', methods=['POST'])
@limiter.limit("5 per hour; 1 per minute")
@login_required
def create_community_post():
    data      = request.get_json(silent=True) or {}
    text      = (data.get('text') or '').strip()
    media_key = (data.get('media_key') or '').strip()
    post_type = (data.get('post_type') or '').strip().lower()
    if post_type not in VALID_POST_TYPES:
        post_type = ''
    if not text and not media_key:
        return jsonify({'error': 'Empty post'}), 400
    if len(text) > 500:
        return jsonify({'error': 'Too long (max 500 chars)'}), 400
    if media_key and not media_key.startswith('shared/'):
        return jsonify({'error': 'Invalid media key'}), 400

    # Duplicate guard: same text posted by this user in the last 10 minutes
    if text:
        cutoff = datetime.utcnow() - timedelta(minutes=10)
        recent = Note.query.filter(
            Note.user_id    == session['user_id'],
            Note.entry_type == 'community_post',
            Note.is_deleted == False,
            Note.created_at >= cutoff
        ).all()
        for d in recent:
            if unpack_post_body(d.body or '')['text'].strip() == text:
                return jsonify({'error': 'You already posted this recently.'}), 429

    text_order = (data.get('text_order') or '').strip() or None
    if text_order not in (None, 'tm', 'mt'):
        text_order = None
    skill_tag = (data.get('skill_tag') or '').strip() or None

    p = Note(user_id=session['user_id'], entry_type='community_post',
             is_deleted=False, is_finished=False)
    p.body = pack_post_body(text=text, media_key=media_key or None,
                            post_type=post_type or None,
                            text_order=text_order, skill_tag=skill_tag)
    p.mood = session.get('distro', 'Ocellus')
    db.session.add(p)
    db.session.commit()
    return jsonify({'id': p.id, 'ok': True}), 201


@pug_bp.route('/pug/api/community/<int:pid>', methods=['GET'])
@login_required
def get_community_post(pid):
    from shared.auth.user import User
    me = session['user_id']
    p = Note.query.filter(Note.id == pid, Note.entry_type == 'community_post',
                          Note.is_deleted == False, Note.mood.in_(FEED_DISTROS)).first()
    if not p:
        return jsonify({'error': 'Not found'}), 404
    u = db.session.get(User, p.user_id)
    if not u:
        return jsonify({'error': 'Not found'}), 404
    row = _post_row(p, u, me)
    return jsonify(_enrich([row], me)[0])


@pug_bp.route('/pug/api/community/<int:pid>', methods=['DELETE'])
@login_required
def delete_community_post(pid):
    p = Note.query.filter_by(id=pid, user_id=session['user_id'], entry_type='community_post').first()
    if not p:
        return jsonify({'error': 'Not found'}), 404
    p.is_deleted = True
    db.session.commit()
    return jsonify({'ok': True})


def _toggle_reaction(entry_type, target_id, rtype, me):
    """Shared like/dislike toggle for posts and comments. Returns counts."""
    existing = Note.query.filter_by(
        user_id=me, entry_type=entry_type, mood=str(target_id), is_deleted=False
    ).first()
    is_new_like = False
    if existing:
        same = (existing.is_finished and rtype == 'like') or \
               (not existing.is_finished and rtype == 'dislike')
        if same:
            existing.is_deleted = True
        else:
            existing.is_finished = (rtype == 'like')
    else:
        db.session.add(Note(user_id=me, entry_type=entry_type, is_deleted=False,
                            mood=str(target_id), is_finished=(rtype == 'like')))
        is_new_like = (rtype == 'like')
    db.session.commit()
    rows = Note.query.filter_by(entry_type=entry_type, mood=str(target_id), is_deleted=False).all()
    likes    = sum(1 for r in rows if r.is_finished)
    dislikes = sum(1 for r in rows if not r.is_finished)
    my_row   = next((r for r in rows if r.user_id == me), None)
    my_react = ('like' if my_row.is_finished else 'dislike') if my_row else None
    return likes, dislikes, my_react, is_new_like


@pug_bp.route('/pug/api/community/<int:pid>/react', methods=['POST'])
@limiter.limit("60 per minute")
@login_required
def react_post(pid):
    me    = session['user_id']
    data  = request.get_json(silent=True) or {}
    rtype = (data.get('type') or '').strip()
    if rtype not in ('like', 'dislike'):
        return jsonify({'error': 'Invalid'}), 400
    likes, dislikes, my_react, is_new_like = _toggle_reaction('post_react', pid, rtype, me)
    # EXP for the author on a brand-new like (not on toggle/remove)
    if is_new_like:
        post = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
        if post and post.user_id != me:
            sk = post_skill_tag(post)
            if sk:
                award_exp(post.user_id, sk, 'like')
    return jsonify({'likes': likes, 'dislikes': dislikes, 'my_reaction': my_react})


@pug_bp.route('/pug/api/community/<int:pid>/comment/<int:cid>/react', methods=['POST'])
@limiter.limit("60 per minute")
@login_required
def react_comment(pid, cid):
    data  = request.get_json(silent=True) or {}
    rtype = (data.get('type') or '').strip()
    if rtype not in ('like', 'dislike'):
        return jsonify({'error': 'Invalid'}), 400
    likes, dislikes, my_react, _ = _toggle_reaction('comment_react', cid, rtype, session['user_id'])
    return jsonify({'likes': likes, 'dislikes': dislikes, 'my_reaction': my_react})


@pug_bp.route('/pug/api/community/<int:pid>/comments', methods=['GET'])
@login_required
def get_post_comments(pid):
    me = session['user_id']
    parent = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
    pinned_cid  = None
    post_author = None
    if parent:
        post_author = parent.user_id
        pinned_cid  = unpack_post_body(parent.body or '')['pinned_cid']

    comments = Note.query.filter_by(
        entry_type='post_comment', mood=str(pid), is_deleted=False
    ).order_by(Note.created_at.asc()).limit(50).all()

    comment_ids = [c.id for c in comments]
    creact_rows = Note.query.filter(
        Note.entry_type == 'comment_react',
        Note.mood.in_([str(i) for i in comment_ids]),
        Note.is_deleted == False
    ).all() if comment_ids else []
    c_likes, c_dislikes, c_mine = {}, {}, {}
    for r in creact_rows:
        cid = int(r.mood)
        if r.is_finished:
            c_likes[cid] = c_likes.get(cid, 0) + 1
        else:
            c_dislikes[cid] = c_dislikes.get(cid, 0) + 1
        if r.user_id == me:
            c_mine[cid] = 'like' if r.is_finished else 'dislike'

    users  = _users_by_id([c.user_id for c in comments])
    result = []
    for c in comments:
        u = users.get(c.user_id)
        if not u:
            continue
        result.append({
            'id':          c.id,
            'user_id':     c.user_id,
            'username':    u.username,
            'text':        c.body,
            'created_at':  c.created_at.isoformat() if c.created_at else None,
            'is_mine':     c.user_id == me,
            'is_pinned':   c.id == pinned_cid,
            'can_pin':     post_author == me,
            'likes':       c_likes.get(c.id, 0),
            'dislikes':    c_dislikes.get(c.id, 0),
            'my_reaction': c_mine.get(c.id),
        })
    result.sort(key=lambda c: (0 if c['is_pinned'] else 1, 0))
    return jsonify(result)


@pug_bp.route('/pug/api/community/<int:pid>/comment', methods=['POST'])
@limiter.limit("30 per hour; 5 per minute")
@login_required
def add_post_comment(pid):
    me   = session['user_id']
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty'}), 400
    if len(text) > 300:
        return jsonify({'error': 'Too long (max 300 chars)'}), 400
    parent = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
    if not parent:
        return jsonify({'error': 'Post not found'}), 404
    c = Note(user_id=me, entry_type='post_comment', is_deleted=False, mood=str(pid))
    c.body = text
    db.session.add(c)
    db.session.commit()

    if parent.user_id != me:
        sk = post_skill_tag(parent)
        if sk:
            award_exp(parent.user_id, sk, 'comment')
        # Notification rendered inside the author's DM stream
        from shared.auth.user import User
        commenter    = db.session.get(User, me)
        parent_text  = unpack_post_body(parent.body or '')['text']
        post_snippet = parent_text.strip()[:60]
        notif_body = (f'§§NOTIF§§{commenter.username} commented on your post: '
                      f'"{post_snippet}{"…" if len(parent_text) > 60 else ""}"'
                      f'§§END§§💬 "{text[:80]}{"…" if len(text) > 80 else ""}"')
        notif = Note(user_id=me, entry_type='dm', is_deleted=False,
                     mood=str(parent.user_id), is_finished=False)
        notif.body = notif_body
        db.session.add(notif)
        db.session.commit()
    return jsonify({'id': c.id, 'ok': True}), 201


@pug_bp.route('/pug/api/community/<int:pid>/action', methods=['POST'])
@limiter.limit("30 per hour; 5 per minute")
@login_required
def community_post_action(pid):
    me     = session['user_id']
    data   = request.get_json(silent=True) or {}
    action = (data.get('action') or '').strip().lower()
    if action not in _ACTION_EXP_MAP:
        return jsonify({'error': 'Invalid action'}), 400
    post = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
    if not post or post.user_id == me:
        return jsonify({'ok': True})
    # Dedup: one EXP award per user per post per action
    action_tag = f'{pid}:{action}'
    already = Note.query.filter_by(
        user_id=me, entry_type='post_action_log', mood=action_tag, is_deleted=False
    ).first()
    if not already:
        db.session.add(Note(user_id=me, entry_type='post_action_log',
                            mood=action_tag, is_deleted=False))
        db.session.commit()
        sk = post_skill_tag(post)
        if sk:
            award_exp(post.user_id, sk, _ACTION_EXP_MAP[action])
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/community/<int:pid>/comment/<int:cid>/pin', methods=['POST'])
@login_required
def pin_comment(pid, cid):
    me   = session['user_id']
    post = Note.query.filter_by(id=pid, entry_type='community_post',
                                is_deleted=False, user_id=me).first()
    if not post:
        return jsonify({'error': 'Not your post'}), 403
    b = unpack_post_body(post.body or '')
    new_pin = None if b['pinned_cid'] == cid else cid
    post.body = pack_post_body(text=b['text'], media_key=b['media_key'],
                               post_type=b['post_type'], pinned=new_pin,
                               text_order=b['text_order'] if b['text_order'] != 'tm' else None,
                               skill_tag=b['skill_tag'])
    db.session.commit()
    return jsonify({'ok': True, 'pinned': new_pin})


@pug_bp.route('/pug/api/community/<int:pid>/type', methods=['PATCH'])
@login_required
def update_post_type(pid):
    me        = session['user_id']
    data      = request.get_json(silent=True) or {}
    post_type = (data.get('post_type') or '').strip().lower()
    if post_type not in ('blog', 'showoff', ''):
        return jsonify({'error': 'Invalid type'}), 400
    post = Note.query.filter_by(id=pid, entry_type='community_post',
                                is_deleted=False, user_id=me).first()
    if not post:
        return jsonify({'error': 'Not found'}), 404
    b = unpack_post_body(post.body or '')
    post.body = pack_post_body(text=b['text'], media_key=b['media_key'],
                               post_type=post_type or None, pinned=b['pinned_cid'],
                               text_order=b['text_order'] if b['text_order'] != 'tm' else None,
                               skill_tag=b['skill_tag'])
    db.session.commit()
    return jsonify({'ok': True, 'post_type': post_type or None})
