import os
import uuid
import io
from datetime import datetime, timedelta
from flask import (
    Blueprint, render_template, request,
    jsonify, session, redirect, url_for, current_app, Response
)
from minio import Minio
from minio.error import S3Error
from werkzeug.utils import secure_filename
from svg_models import db
from .notes import Note

# No template_folder — full paths used in render_template
pug_bp = Blueprint(
    'pug',
    __name__,
    static_folder='../../static/pug_style',
    static_url_path='/pug_style'
)

MINIO_ENDPOINT   = os.environ.get('MINIO_ENDPOINT',   'localhost:9000')
MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET     = os.environ.get('MINIO_BUCKET',     'blankit-media')

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False
)

ALLOWED_IMAGE = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
ALLOWED_VIDEO = {'mp4', 'webm'}


def ensure_bucket():
    try:
        if not minio_client.bucket_exists(MINIO_BUCKET):
            minio_client.make_bucket(MINIO_BUCKET)
    except S3Error as e:
        print(f"MinIO bucket error: {e}")


def login_required_page():
    if not session.get('user_id'):
        return redirect(url_for('svg.login'))
    if session.get('distro') != 'thepug':
        return redirect(url_for('svg.login'))
    return None


def login_required_api():
    if not session.get('user_id'):
        return jsonify({'error': 'Not authenticated'}), 401
    if session.get('distro') != 'thepug':
        return jsonify({'error': 'Forbidden'}), 403
    return None


@pug_bp.route('/pug/home')
def home():
    guard = login_required_page()
    if guard:
        return guard
    return render_template('pug_templates/home.html', username=session.get('username', 'User'))


@pug_bp.route('/pug/api/notes', methods=['GET'])
def get_notes():
    err = login_required_api()
    if err: return err
    notes = Note.query.filter_by(
        user_id=session['user_id'], entry_type='note', is_deleted=False
    ).order_by(Note.updated_at.desc()).all()
    return jsonify([n.to_dict() for n in notes])


@pug_bp.route('/pug/api/notes', methods=['POST'])
def save_note():
    err = login_required_api()
    if err: return err
    data = request.get_json()
    if not data:
        return jsonify({'status': 'error'}), 400
    note_id      = data.get('id')
    title        = data.get('title', '')
    body         = data.get('body', '')
    start_dt_str = data.get('start_datetime')
    start_dt = None
    if start_dt_str:
        try:
            start_dt = datetime.strptime(start_dt_str, '%Y-%m-%d')
        except ValueError:
            pass
    if note_id:
        note = Note.query.filter_by(id=note_id, user_id=session['user_id']).first()
        if not note:
            return jsonify({'status': 'error', 'message': 'Not found'}), 404
        note.title = title; note.body = body
        note.start_datetime = start_dt; note.updated_at = datetime.utcnow()
    else:
        note = Note(user_id=session['user_id'], entry_type='note', start_datetime=start_dt)
        note.title = title; note.body = body
        db.session.add(note)
    db.session.commit()
    return jsonify({'status': 'success', 'id': note.id})


@pug_bp.route('/pug/api/notes/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    err = login_required_api()
    if err: return err
    note = Note.query.filter_by(id=note_id, user_id=session['user_id']).first_or_404()
    note.is_deleted = True
    db.session.commit()
    return jsonify({'status': 'success'})


@pug_bp.route('/pug/api/goals', methods=['GET'])
def get_goals():
    err = login_required_api()
    if err: return err
    goals = Note.query.filter_by(
        user_id=session['user_id'], entry_type='goal', is_deleted=False
    ).order_by(Note.created_at.asc()).all()
    return jsonify([g.to_dict() for g in goals])


@pug_bp.route('/pug/api/goals', methods=['POST'])
def add_goal():
    err = login_required_api()
    if err: return err
    data  = request.get_json()
    title = data.get('title', '').strip()
    if not title:
        return jsonify({'status': 'error'}), 400
    goal = Note(user_id=session['user_id'], entry_type='goal')
    goal.title = title
    db.session.add(goal)
    db.session.commit()
    return jsonify({'status': 'success', 'id': goal.id})


@pug_bp.route('/pug/api/goals/<int:goal_id>', methods=['PATCH'])
def update_goal(goal_id):
    err = login_required_api()
    if err: return err
    goal = Note.query.filter_by(
        id=goal_id, user_id=session['user_id'], entry_type='goal'
    ).first_or_404()
    data = request.get_json()
    if 'is_finished' in data:
        goal.is_finished = data['is_finished']
    db.session.commit()
    return jsonify({'status': 'success'})


@pug_bp.route('/pug/api/goals/<int:goal_id>', methods=['DELETE'])
def delete_goal(goal_id):
    err = login_required_api()
    if err: return err
    goal = Note.query.filter_by(
        id=goal_id, user_id=session['user_id'], entry_type='goal'
    ).first_or_404()
    goal.is_deleted = True
    db.session.commit()
    return jsonify({'status': 'success'})


@pug_bp.route('/pug/api/dream', methods=['GET'])
def get_dream():
    err = login_required_api()
    if err: return err
    dream = Note.query.filter_by(
        user_id=session['user_id'], entry_type='dream', is_deleted=False
    ).first()
    return jsonify({'dream': dream.title if dream else None})


@pug_bp.route('/pug/api/dream', methods=['POST'])
def set_dream():
    err = login_required_api()
    if err: return err
    existing = Note.query.filter_by(
        user_id=session['user_id'], entry_type='dream', is_deleted=False
    ).first()
    if existing:
        return jsonify({'status': 'error', 'message': 'Dream already locked'}), 409
    data  = request.get_json()
    title = data.get('title', '').strip()
    if not title:
        return jsonify({'status': 'error'}), 400
    dream = Note(user_id=session['user_id'], entry_type='dream')
    dream.title = title
    db.session.add(dream)
    db.session.commit()
    return jsonify({'status': 'success', 'dream': dream.title})


@pug_bp.route('/pug/api/consistency', methods=['GET'])
def get_consistency():
    err = login_required_api()
    if err: return err
    result = []
    today  = datetime.utcnow().date()
    for i in range(6, -1, -1):
        day   = today - timedelta(days=i)
        start = datetime(day.year, day.month, day.day, 0,  0,  0)
        end   = datetime(day.year, day.month, day.day, 23, 59, 59)
        added = Note.query.filter(
            Note.user_id == session['user_id'], Note.entry_type == 'goal',
            Note.is_deleted == False, Note.created_at >= start, Note.created_at <= end
        ).count()
        finished = Note.query.filter(
            Note.user_id == session['user_id'], Note.entry_type == 'goal',
            Note.is_deleted == False, Note.is_finished == True,
            Note.updated_at >= start, Note.updated_at <= end
        ).count()
        result.append({'day': day.strftime('%a'), 'added': added, 'finished': finished})
    return jsonify(result)


@pug_bp.route('/pug/api/events', methods=['GET'])
def get_events():
    err = login_required_api()
    if err: return err
    events = Note.query.filter(
        Note.user_id == session['user_id'],
        Note.is_deleted == False,
        Note.start_datetime != None
    ).all()
    return jsonify([{
        'id': e.id, 'title': e.title,
        'start_datetime': e.start_datetime.isoformat() if e.start_datetime else None
    } for e in events])


@pug_bp.route('/pug/api/upload', methods=['POST'])
def upload_file():
    err = login_required_api()
    if err: return err
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file     = request.files['file']
    filename = secure_filename(file.filename)
    if not filename:
        return jsonify({'error': 'Empty filename'}), 400
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext in ALLOWED_IMAGE:
        content_type = f'image/{ext if ext != "jpg" else "jpeg"}'
    elif ext in ALLOWED_VIDEO:
        content_type = f'video/{ext}'
    else:
        return jsonify({'error': f'.{ext} not allowed'}), 400
    object_name = f"user_{session['user_id']}/{uuid.uuid4().hex}.{ext}"
    ensure_bucket()
    file_data = file.read()
    minio_client.put_object(
        MINIO_BUCKET, object_name, io.BytesIO(file_data),
        length=len(file_data), content_type=content_type
    )
    return jsonify({'url': url_for('pug.serve_media', object_name=object_name),
                    'type': 'image' if ext in ALLOWED_IMAGE else 'video'})


@pug_bp.route('/pug/api/media/<path:object_name>')
def serve_media(object_name):
    err = login_required_api()
    if err: return err
    if not object_name.startswith(f"user_{session['user_id']}/"):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        response = minio_client.get_object(MINIO_BUCKET, object_name)
        return Response(
            response.stream(32 * 1024),
            content_type=response.headers.get('content-type', 'application/octet-stream')
        )
    except S3Error:
        return jsonify({'error': 'File not found'}), 404


@pug_bp.route('/pug/api/ask', methods=['POST'])
def ask():
    err = login_required_api()
    if err: return err
    data  = request.get_json()
    query = data.get('query', '').strip()
    if not query:
        return jsonify({'error': 'Empty query'}), 400
    import requests as req
    try:
        r = req.get('https://api.duckduckgo.com/',
                    params={'q': query, 'format': 'json', 'no_html': 1, 'skip_disambig': 1},
                    timeout=5)
        result = r.json()
        answer = result.get('AbstractText') or result.get('Answer') or \
                 "No direct answer found. Try rephrasing."
        return jsonify({'answer': answer})
    except Exception as e:
        current_app.logger.error(f"Ask error: {e}")
        return jsonify({'error': 'Knowledge engine unavailable'}), 503