"""Achievements + verification (link or media proof)."""
import json
import re
import uuid

from flask import jsonify, request, session

from shared.extensions import db, limiter
from distro.pug.models import Note, unpack_achievement_body
from . import pug_bp
from .guards import login_required
from .helpers import bust_cached_sheet
from .media import (ALLOWED_AUDIO, ALLOWED_IMAGE, content_type_for,
                    read_upload, store_object)

ALLOWED_VERIFY_MEDIA = ALLOWED_AUDIO | ALLOWED_IMAGE | {'mp4', 'webm', 'mov', 'avi'}


def _achievement_row(n):
    a = unpack_achievement_body(n.body)
    return {'id': n.id, 'title': n.title, 'desc': a['desc'], 'proof': a['proof'],
            'verified': a['verify_status'], 'vlink': a['verify_link'],
            'created_at': n.created_at.isoformat() if n.created_at else None}


@pug_bp.route('/pug/api/achievements', methods=['GET'])
@login_required
def get_achievements():
    items = Note.query.filter_by(
        user_id=session['user_id'], entry_type='achievement', is_deleted=False
    ).order_by(Note.created_at.desc()).all()
    return jsonify([_achievement_row(n) for n in items])


@pug_bp.route('/pug/api/achievements', methods=['POST'])
@limiter.limit("30 per hour")
@login_required
def add_achievement():
    data  = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Title required'}), 400
    desc  = (data.get('description') or '').strip()
    proof = (data.get('proof') or '').strip()
    n = Note(user_id=session['user_id'], entry_type='achievement',
             is_deleted=False, is_finished=False)
    n.title = title
    n.body  = json.dumps({'d': desc, 'p': proof}) if (desc or proof) else ''
    db.session.add(n)
    db.session.commit()
    return jsonify({'id': n.id, 'title': n.title, 'desc': desc, 'proof': proof}), 201


@pug_bp.route('/pug/api/achievements/<int:aid>', methods=['DELETE'])
@login_required
def delete_achievement(aid):
    n = Note.query.filter_by(id=aid, user_id=session['user_id'], entry_type='achievement').first()
    if not n:
        return jsonify({'error': 'Not found'}), 404
    n.is_deleted = True
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/achievements/<int:aid>/verify', methods=['PATCH'])
@limiter.limit("20 per hour")
@login_required
def verify_achievement(aid):
    n = Note.query.filter_by(id=aid, user_id=session['user_id'], entry_type='achievement').first()
    if not n:
        return jsonify({'error': 'Not found'}), 404

    existing = {}
    if n.body and n.body.startswith('{'):
        try:
            existing = json.loads(n.body)
        except Exception:
            pass

    link = ''
    if request.is_json:
        data = request.get_json(silent=True) or {}
        link = (data.get('link') or '').strip()
    elif request.form:
        link = (request.form.get('link') or '').strip()

    if link:
        # Only http/https — blocks javascript: and data: URIs
        if not re.match(r'^https?://', link):
            return jsonify({'error': 'Link must be an http/https URL'}), 400
        if len(link) > 2048:
            return jsonify({'error': 'Link too long'}), 400
        existing['vl'] = link
        existing['vs'] = 'link'

    file = request.files.get('media') if request.files else None
    if file and file.filename:
        ext, data, _, err = read_upload(file, ALLOWED_VERIFY_MEDIA)
        if err:
            return err
        ct, _ = content_type_for(ext)
        object_name = f"user_{session['user_id']}/verify_{uuid.uuid4().hex}.{ext}"
        store_object(object_name, data, ct or 'application/octet-stream')
        existing['vm'] = object_name
        existing['vs'] = 'media'

    if not link and not (file and file.filename):
        return jsonify({'error': 'Provide a link or upload media'}), 400

    n.body = json.dumps(existing)
    db.session.commit()

    # Bust the stats cache so the rank judge re-runs with the new evidence
    bust_cached_sheet(session['user_id'])

    return jsonify(_achievement_row(n))
