"""Character sheet (stats), skills, EXP."""
import os
from datetime import datetime, timedelta

from flask import jsonify, request, session

from shared.extensions import db, limiter
from distro.pug.models import Note
from distro.pug.services.sheet_ai import assemble_user_context, generate_character_sheet
from . import pug_bp
from .guards import login_required
from .helpers import (award_exp, get_cached_sheet, get_exp_config,
                      save_cached_sheet)
from .media import UPLOAD_LOCAL_DIR


def calc_streak(user_id):
    one_year_ago = datetime.utcnow() - timedelta(days=365)
    entries = Note.query.filter(
        Note.user_id == user_id,
        Note.is_deleted == False,
        Note.entry_type.in_(['note', 'goal']),
        Note.updated_at >= one_year_ago
    ).with_entities(Note.updated_at, Note.created_at).all()

    active_dates = set()
    for e in entries:
        for dt in (e.updated_at, e.created_at):
            if dt:
                active_dates.add(dt.date())

    today  = datetime.utcnow().date()
    check  = today if today in active_dates else today - timedelta(days=1)
    streak = 0
    for i in range(365):
        if (check - timedelta(days=i)) in active_dates:
            streak += 1
        else:
            break
    return streak


def _count_media(user_id):
    user_dir = os.path.join(UPLOAD_LOCAL_DIR, f'user_{user_id}')
    if not os.path.isdir(user_dir):
        return 0
    try:
        return len([f for f in os.listdir(user_dir)
                    if os.path.isfile(os.path.join(user_dir, f))])
    except OSError:
        return 0


def _ensure_skill_habits(user_id, skills):
    """Auto-create a habit for any confirmed skill that has no matching habit yet."""
    from distro.svg.models.habit import Habit
    if not skills:
        return
    existing = [h.name.lower() for h in Habit.query.filter_by(user_id=user_id, is_active=True).all()]
    added = False
    for s in skills:
        skill_name = (s.get('name') or '').strip()
        if not skill_name:
            continue
        if any(skill_name.lower() in h or h in skill_name.lower() for h in existing):
            continue
        db.session.add(Habit(user_id=user_id, name=skill_name, track_type='manual'))
        existing.append(skill_name.lower())
        added = True
    if added:
        db.session.commit()


def _ai_to_suggestions(ai_sheet, keep_skills):
    """Convert AI-generated skills into suggestions, preserving confirmed user skills."""
    confirmed = {s.get('name') for s in keep_skills}
    ai_sheet['suggestions'] = [
        {'name': s['name'], 'class_id': s.get('class_id', ''), 'class_label': s.get('class_label', '')}
        for s in (ai_sheet.pop('skills', None) or [])
        if s.get('name') and s['name'] not in confirmed
    ]
    return ai_sheet


@pug_bp.route('/pug/api/stats', methods=['GET'])
@limiter.limit("10 per minute")
@login_required
def get_stats_sheet():
    user_id    = session['user_id']
    refresh    = request.args.get('refresh',    'false').lower() == 'true'
    cache_only = request.args.get('cache_only', 'false').lower() == 'true'

    notes_count = Note.query.filter_by(
        user_id=user_id, entry_type='note', is_deleted=False
    ).count()
    streak      = calc_streak(user_id)
    media_count = _count_media(user_id)
    db_sheet    = get_cached_sheet(user_id)
    sheet       = db_sheet

    if cache_only:
        pass  # page-load silent fetch: never generate
    elif refresh:
        # Regenerate personality/class/bio/suggestions; preserve confirmed skills
        old_sheet    = db_sheet or {}
        user_context = assemble_user_context(user_id, session.get('username', ''))
        new_sheet    = generate_character_sheet(user_id, user_context, notes_count, streak)
        if new_sheet:
            new_sheet['skills'] = old_sheet.get('skills', [])
            _ai_to_suggestions(new_sheet, new_sheet['skills'])
            sheet = new_sheet
            save_cached_sheet(user_id, sheet)
    elif not db_sheet:
        # First use — generate once
        user_context = assemble_user_context(user_id, session.get('username', ''))
        new_sheet    = generate_character_sheet(user_id, user_context, notes_count, streak)
        if new_sheet:
            new_sheet['skills'] = []
            _ai_to_suggestions(new_sheet, [])
            sheet = new_sheet
            save_cached_sheet(user_id, sheet)

    return jsonify({
        'notes_count': notes_count,
        'streak':      streak,
        'media_count': media_count,
        'sheet':       sheet,
    })


@pug_bp.route('/pug/api/stats/skill-class', methods=['PATCH'])
@login_required
def update_skill_class():
    user_id     = session['user_id']
    data        = request.get_json(silent=True) or {}
    skill_name  = (data.get('name') or '').strip()
    class_id    = (data.get('class_id') or '').strip()
    class_label = (data.get('class_label') or '').strip()
    if not skill_name:
        return jsonify({'error': 'name required'}), 400
    sheet  = get_cached_sheet(user_id) or {}
    skills = sheet.get('skills', [])
    for s in skills:
        if s.get('name') == skill_name:
            s['class_id']    = class_id
            s['class_label'] = class_label
            break
    sheet['skills'] = skills
    save_cached_sheet(user_id, sheet)
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/stats/skill', methods=['POST'])
@login_required
def add_skill_manual():
    user_id     = session['user_id']
    data        = request.get_json(silent=True) or {}
    name        = (data.get('name') or '').strip()
    class_id    = (data.get('class_id') or '').strip()
    class_label = (data.get('class_label') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    sheet  = get_cached_sheet(user_id) or {}
    skills = sheet.get('skills', [])
    if not any(s.get('name') == name and s.get('class_id') == class_id for s in skills):
        skills.append({
            'name': name, 'rank': 'E-', 'verified': False,
            'context': '', 'note': 'Add proof in Achievements to unlock a real rank.',
            'class_id': class_id, 'class_label': class_label, 'exp': 0,
            'user_added': True,
        })
        sheet['skills'] = skills
        sheet['suggestions'] = [s for s in sheet.get('suggestions', []) if s.get('name') != name]
        save_cached_sheet(user_id, sheet)
        _ensure_skill_habits(user_id, [{'name': name}])
    return jsonify({'ok': True, 'sheet': sheet})


@pug_bp.route('/pug/api/stats/skill', methods=['DELETE'])
@login_required
def remove_skill():
    user_id  = session['user_id']
    data     = request.get_json(silent=True) or {}
    name     = (data.get('name') or '').strip()
    class_id = (data.get('class_id') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    sheet = get_cached_sheet(user_id) or {}
    sheet['skills'] = [
        s for s in sheet.get('skills', [])
        if not (s.get('name') == name and s.get('class_id', '') == class_id)
    ]
    save_cached_sheet(user_id, sheet)
    return jsonify({'ok': True, 'sheet': sheet})


@pug_bp.route('/pug/api/stats/skill-suggestion/dismiss', methods=['POST'])
@login_required
def dismiss_suggestion():
    user_id = session['user_id']
    data    = request.get_json(silent=True) or {}
    name    = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    sheet = get_cached_sheet(user_id) or {}
    sheet['suggestions'] = [s for s in sheet.get('suggestions', []) if s.get('name') != name]
    save_cached_sheet(user_id, sheet)
    return jsonify({'ok': True, 'sheet': sheet})


@pug_bp.route('/pug/api/stats/skill/exp', methods=['POST'])
@login_required
def add_skill_exp():
    """Award EXP to a skill for a given action. Body: {skill, action, count?}"""
    user_id = session['user_id']
    data    = request.get_json(silent=True) or {}
    skill   = (data.get('skill') or '').strip()
    action  = (data.get('action') or '').strip()
    try:
        count = int(data.get('count', 1))
    except (TypeError, ValueError):
        count = 1
    if not skill or not action:
        return jsonify({'error': 'skill and action required'}), 400
    if action not in get_exp_config().get('action_weights', {}):
        return jsonify({'error': f'unknown action: {action}'}), 400
    sheet = award_exp(user_id, skill, action, count)
    if sheet is None:
        return jsonify({'error': 'skill not found in your sheet'}), 404
    return jsonify({'ok': True, 'sheet': sheet})
