"""Media uploads + serving (MinIO/B2 primary, local-disk fallback)."""
import io
import mimetypes
import os
import uuid

from flask import Response, current_app, jsonify, request, session, url_for
from minio import Minio
from minio.error import S3Error
from werkzeug.utils import secure_filename

from shared.extensions import limiter
from . import pug_bp
from .guards import login_required

MINIO_ENDPOINT   = os.environ.get('MINIO_ENDPOINT',   'localhost:9000')
MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET     = os.environ.get('MINIO_BUCKET',     'veyra-media')
MINIO_SECURE     = os.environ.get('MINIO_SECURE',     'false').lower() == 'true'
UPLOAD_LOCAL_DIR = os.environ.get(
    'UPLOAD_DIR',
    '/data/veyra_media' if os.path.isdir('/data') else '/tmp/veyra_media'
)

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=MINIO_SECURE,
)

MAX_UPLOAD = 50 * 1024 * 1024  # 50 MB

ALLOWED_IMAGE = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
ALLOWED_VIDEO = {'mp4', 'webm'}
ALLOWED_AUDIO = {'mp3', 'wav', 'ogg', 'm4a', 'flac'}

# Magic-byte signatures — checked before any processing to reject spoofed extensions
_MAGIC = {
    'jpg':  (b'\xff\xd8\xff',),
    'jpeg': (b'\xff\xd8\xff',),
    'png':  (b'\x89PNG',),
    'gif':  (b'GIF87a', b'GIF89a'),
    'webp': (b'RIFF',),
    'mp4':  (b'\x00\x00\x00',),
    'webm': (b'\x1a\x45\xdf\xa3',),
    'mp3':  (b'\xff\xfb', b'\xff\xf3', b'\xff\xf2', b'ID3'),
    'wav':  (b'RIFF',),
    'ogg':  (b'OggS',),
    'm4a':  (b'\x00\x00\x00',),
    'flac': (b'fLaC',),
    'mov':  (b'\x00\x00\x00',),
    'avi':  (b'RIFF',),
}


def valid_magic(data: bytes, ext: str) -> bool:
    sigs = _MAGIC.get(ext)
    if not sigs:
        return True
    return any(data[:len(s)] == s for s in sigs)


def content_type_for(ext):
    if ext in ALLOWED_IMAGE:
        return f'image/{"jpeg" if ext == "jpg" else ext}', 'image'
    if ext in ALLOWED_VIDEO or ext in ('mov', 'avi'):
        return f'video/{ext}', 'video'
    if ext in ALLOWED_AUDIO:
        return f'audio/{ext}', 'audio'
    return None, None


def ensure_bucket():
    try:
        if not minio_client.bucket_exists(MINIO_BUCKET):
            # R2 buckets must be created in the dashboard — skip auto-create
            if 'r2.cloudflarestorage.com' not in MINIO_ENDPOINT:
                minio_client.make_bucket(MINIO_BUCKET)
    except S3Error as e:
        current_app.logger.warning(f'Storage bucket check failed: {e}')


def store_object(object_name, file_data, content_type):
    """Put to MinIO; on failure persist to local disk so uploads never 500."""
    try:
        ensure_bucket()
        minio_client.put_object(
            MINIO_BUCKET, object_name, io.BytesIO(file_data),
            length=len(file_data), content_type=content_type,
        )
    except Exception as e:
        current_app.logger.warning(f'Object storage unavailable, using local disk: {e}')
        local_path = os.path.join(UPLOAD_LOCAL_DIR, object_name)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, 'wb') as fh:
            fh.write(file_data)


def _safe_object_path(object_name):
    return ('..' not in object_name
            and '\x00' not in object_name
            and '\\' not in object_name)


def _serve_object(object_name):
    try:
        response = minio_client.get_object(MINIO_BUCKET, object_name)
        return Response(
            response.stream(32 * 1024),
            content_type=response.headers.get('content-type', 'application/octet-stream'),
        )
    except Exception:
        pass
    local_path = os.path.join(UPLOAD_LOCAL_DIR, object_name)
    if os.path.exists(local_path):
        ct = mimetypes.guess_type(local_path)[0] or 'application/octet-stream'
        with open(local_path, 'rb') as f:
            return Response(f.read(), content_type=ct)
    return jsonify({'error': 'File not found'}), 404


def read_upload(file, allowed_exts):
    """Validate an uploaded file. Returns (ext, data, ftype, error_response)."""
    filename = secure_filename(file.filename or '')
    if not filename:
        return None, None, None, (jsonify({'error': 'Empty filename'}), 400)
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in allowed_exts:
        return None, None, None, (jsonify({'error': f'.{ext} not allowed'}), 400)
    data = file.read()
    if len(data) > MAX_UPLOAD:
        return None, None, None, (jsonify({'error': 'File too large (max 50 MB)'}), 400)
    if not valid_magic(data, ext):
        return None, None, None, (jsonify({'error': 'File content does not match extension'}), 400)
    _, ftype = content_type_for(ext)
    return ext, data, ftype, None


# ── Private media (scoped to the uploading user) ─────────────────────────────

@pug_bp.route('/pug/api/upload', methods=['POST'])
@limiter.limit("30 per minute")
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    ext, data, ftype, err = read_upload(request.files['file'], ALLOWED_IMAGE | ALLOWED_VIDEO)
    if err:
        return err
    ct, _ = content_type_for(ext)
    object_name = f"user_{session['user_id']}/{uuid.uuid4().hex}.{ext}"
    store_object(object_name, data, ct)
    return jsonify({'url': url_for('pug.serve_media', object_name=object_name),
                    'type': ftype})


@pug_bp.route('/pug/api/media/<path:object_name>')
@login_required
def serve_media(object_name):
    if not _safe_object_path(object_name):
        return jsonify({'error': 'Forbidden'}), 403
    if not object_name.startswith(f"user_{session['user_id']}/"):
        return jsonify({'error': 'Forbidden'}), 403
    return _serve_object(object_name)


# ── Shared media (community posts, DMs) ──────────────────────────────────────

@pug_bp.route('/pug/api/upload_shared', methods=['POST'])
@limiter.limit("30 per minute")
@login_required
def upload_shared():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    ext, data, ftype, err = read_upload(
        request.files['file'], ALLOWED_IMAGE | ALLOWED_VIDEO | ALLOWED_AUDIO)
    if err:
        return err
    ct, _ = content_type_for(ext)
    object_name = f"shared/{uuid.uuid4().hex}.{ext}"
    store_object(object_name, data, ct)
    return jsonify({
        'key':  object_name,
        'url':  url_for('pug.serve_media_shared', object_name=object_name),
        'type': ftype,
    })


@pug_bp.route('/pug/api/media/shared/<path:object_name>')
@login_required
def serve_media_shared(object_name):
    if not object_name.startswith('shared/') or not _safe_object_path(object_name):
        return jsonify({'error': 'Forbidden'}), 403
    return _serve_object(object_name)
