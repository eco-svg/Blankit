import os
import re
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
from .bot_prompts import BLINKBOT_SYSTEM, BUDDYBOT_SYSTEM

try:
    from llama_cpp import Llama
    _LLAMA_OK = True
except ImportError:
    _LLAMA_OK = False

_MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'pug_modals')
_BLINK_PATH = os.environ.get('BLINKBOT_PATH', os.path.join(_MODELS_DIR, 'blinkbot', 'BlinkBot_1.5B_Final.Q4_K_M.gguf'))
_BUDDY_PATH = os.environ.get('BUDDYBOT_PATH', os.path.join(_MODELS_DIR, 'buddybot', 'BuddyBot_8B_Final.Q4_K_M.gguf'))

_buddybot_model = None
_BUDDYBOT_ENABLED = os.environ.get('BUDDYBOT_ENABLED', 'false').lower() == 'true'


def _get_buddybot():
    global _buddybot_model
    if _buddybot_model is None:
        _buddybot_model = Llama(
            model_path=_BUDDY_PATH,
            n_ctx=2048,
            n_threads=os.cpu_count() or 4,
            chat_format='chatml',
            verbose=False,
            use_mlock=False,
        )
    return _buddybot_model


def _assemble_user_context(user_id, username):
    from svg_models.user import User
    user = User.query.get(user_id)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)

    recent_notes = Note.query.filter(
        Note.user_id == user_id,
        Note.entry_type == 'note',
        Note.is_deleted == False,
        Note.created_at >= seven_days_ago
    ).order_by(Note.created_at.desc()).limit(8).all()

    active_goals = Note.query.filter_by(
        user_id=user_id, entry_type='goal', is_deleted=False, is_finished=False
    ).order_by(Note.created_at.asc()).all()

    finished_this_week = Note.query.filter(
        Note.user_id == user_id,
        Note.entry_type == 'goal',
        Note.is_deleted == False,
        Note.is_finished == True,
        Note.updated_at >= seven_days_ago
    ).all()

    dream = Note.query.filter_by(
        user_id=user_id, entry_type='dream', is_deleted=False
    ).first()

    return {
        'username':           username,
        'member_since':       user.created_at.strftime('%Y-%m-%d') if user and user.created_at else 'unknown',
        'dream':              dream.title if dream else None,
        'active_goals':       [g.title for g in active_goals],
        'finished_this_week': [g.title for g in finished_this_week],
        'recent_notes':       [
            {
                'title':   n.title or '(untitled)',
                'excerpt': (n.body[:200] + '...') if len(n.body) > 200 else n.body,
                'date':    n.created_at.strftime('%Y-%m-%d')
            }
            for n in recent_notes
        ]
    }


def _build_context_block(ctx):
    lines = [
        '',
        '────────────────────────────────────────',
        'INJECTED USER CONTEXT (PRE-FETCHED)',
        '────────────────────────────────────────',
        f'Username     : {ctx["username"]}',
        f'Member since : {ctx["member_since"]}',
        f'Locked Dream : {ctx["dream"] or "Not set yet"}',
        '',
        'Active Goals:',
    ]
    for g in ctx['active_goals'] or ['  None']:
        lines.append(f'  - {g}')

    lines.append('')
    lines.append('Completed Goals (last 7 days):')
    for g in ctx['finished_this_week'] or ['  None']:
        lines.append(f'  - {g}')

    lines.append('')
    lines.append('Recent Notes (last 7 days):')
    if ctx['recent_notes']:
        for n in ctx['recent_notes']:
            lines.append(f'  [{n["date"]}] {n["title"]}: {n["excerpt"]}')
    else:
        lines.append('  None')

    lines += [
        '',
        '────────────────────────────────────────',
        'EXECUTION NOTE',
        '────────────────────────────────────────',
        'fetch_user_profile, fetch_dashboard_data, fetch_memory_recent have been',
        'pre-executed and injected above. Skip those tool calls.',
        'Handle light tasks directly.',
        'Route complex reasoning to BuddyBot via the route_to_server tool call.',
    ]
    return '\n'.join(lines)


def _call_buddybot(context_packet, user_context):
    ctx_line = (
        f"Username: {user_context['username']}, "
        f"Member since: {user_context['member_since']}, "
        f"Dream: {user_context['dream'] or 'not set'}, "
        f"Active Goals: {', '.join(user_context['active_goals']) or 'none'}."
    )
    user_msg = f"[CONTEXT] {ctx_line}\n\n{context_packet}"

    model = _get_buddybot()
    out   = model.create_chat_completion(
        messages=[
            {'role': 'system', 'content': BUDDYBOT_SYSTEM},
            {'role': 'user',   'content': user_msg}
        ],
        max_tokens=600,
        temperature=0.7,
        stop=['<|im_end|>', '</s>']
    )
    raw   = out['choices'][0]['message']['content']
    clean = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL)
    return clean.strip()

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
    api_key = os.environ.get('GROQ_API_KEY', '')
    if not api_key:
        return jsonify({'error': 'AI API key not configured'}), 503
    try:
        r = req.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'llama-3.1-8b-instant',
                'messages': [
                    {'role': 'system', 'content': 'You are a concise knowledge assistant. Answer questions clearly and briefly.'},
                    {'role': 'user', 'content': query}
                ],
                'max_tokens': 512
            },
            timeout=15
        )
        result = r.json()
        if not r.ok:
            current_app.logger.error(f"Groq API error {r.status_code}: {result}")
            return jsonify({'error': 'Knowledge engine unavailable'}), 503
        answer = result['choices'][0]['message']['content']
        return jsonify({'answer': answer})
    except Exception as e:
        current_app.logger.error(f"Ask error: {e}")
        return jsonify({'error': 'Knowledge engine unavailable'}), 503


@pug_bp.route('/pug/api/blinkbot', methods=['POST'])
def blinkbot_chat():
    """
    Temporary server-side endpoint used only by the local BlinkBot client.
    BlinkBot assembles context on-device and POSTs a context packet here.
    This endpoint forwards it straight to BuddyBot and returns the answer.
    No BlinkBot model runs on the server — only BuddyBot.
    """
    err = login_required_api()
    if err: return err

    if not _LLAMA_OK or not _BUDDYBOT_ENABLED:
        return jsonify({'error': 'BuddyBot not available on this server'}), 503

    data    = request.get_json()
    message = data.get('message', '').strip()

    if not message:
        return jsonify({'error': 'Empty message'}), 400

    try:
        user_context = _assemble_user_context(session['user_id'], session.get('username', ''))
        goals_str    = ', '.join(user_context['active_goals']) or 'none'
        notes_str    = ', '.join(n['title'] for n in user_context['recent_notes']) or 'none'

        context_packet = (
            f"situation_type: general\n"
            f"user_signals: username={user_context['username']}, "
            f"dream={user_context['dream'] or 'not set'}, "
            f"active_goals=[{goals_str}]\n"
            f"recent_pattern: recent notes titled [{notes_str}]\n"
            f"question_core: {message}\n"
            f"task: answer_directly"
        )

        final = _call_buddybot(context_packet, user_context)

        from .chat_logger import append_chat_entry
        append_chat_entry(session['user_id'], message, final)

        return jsonify({'answer': final, 'routed': True})

    except Exception as e:
        current_app.logger.error(f"BlinkBot relay error: {e}")
        return jsonify({'error': 'BuddyBot unavailable'}), 503


@pug_bp.route('/pug/api/buddybot', methods=['POST'])
def buddybot_endpoint():
    """Called by a local BlinkBot client when it decides to route to BuddyBot."""
    err = login_required_api()
    if err: return err

    if not _LLAMA_OK or not _BUDDYBOT_ENABLED:
        return jsonify({'error': 'BuddyBot not available on this server'}), 503

    data           = request.get_json()
    context_packet = data.get('context_packet', '').strip()
    ctx_data       = data.get('user_context', {})

    if not context_packet:
        return jsonify({'error': 'No context packet'}), 400

    try:
        user_context = {
            'username':           ctx_data.get('username', session.get('username', '')),
            'member_since':       ctx_data.get('member_since', ''),
            'dream':              ctx_data.get('dream'),
            'active_goals':       ctx_data.get('active_goals', []),
            'finished_this_week': ctx_data.get('finished_this_week', []),
            'recent_notes':       ctx_data.get('recent_notes', [])
        }
        answer = _call_buddybot(context_packet, user_context)
        return jsonify({'answer': answer})

    except Exception as e:
        current_app.logger.error(f"BuddyBot endpoint error: {e}")
        return jsonify({'error': 'BuddyBot unavailable'}), 503


@pug_bp.route('/pug/api/blinkbot-context', methods=['GET'])
def blinkbot_context():
    """
    Called by the local BlinkBot client on session start.
    Returns the full system prompt with fresh user context injected,
    plus the server's BuddyBot endpoint URL.
    """
    err = login_required_api()
    if err: return err
    user_context = _assemble_user_context(session['user_id'], session.get('username', ''))
    ctx_block    = _build_context_block(user_context)
    return jsonify({
        'system_prompt':    BLINKBOT_SYSTEM + ctx_block,
        'user_context':     user_context,
        'buddybot_endpoint': '/pug/api/buddybot'
    })


@pug_bp.route('/pug/download/blinkbot-model')
def download_blinkbot_model():
    err = login_required_page()
    if err: return err
    from flask import send_file
    return send_file(
        _BLINK_PATH,
        as_attachment=True,
        download_name='BlinkBot_1.5B.gguf'
    )


@pug_bp.route('/pug/download/blinkbot-modelfile')
def download_blinkbot_modelfile():
    err = login_required_page()
    if err: return err
    modelfile = (
        "FROM ~/BlinkBot_1.5B.gguf\n\n"
        "TEMPLATE \"\"\"<|im_start|>system\n"
        "{{ .System }}<|im_end|>\n"
        "<|im_start|>user\n"
        "{{ .Prompt }}<|im_end|>\n"
        "<|im_start|>assistant\n"
        "\"\"\"\n\n"
        "PARAMETER stop \"<|im_end|>\"\n"
        "PARAMETER stop \"<|im_start|>\"\n"
        "PARAMETER num_ctx 4096\n"
    )
    from flask import make_response
    r = make_response(modelfile)
    r.headers['Content-Type']        = 'text/plain'
    r.headers['Content-Disposition'] = 'attachment; filename=BlinkbotModelfile'
    return r


@pug_bp.route('/pug/download/blinkbot-setup')
def download_blinkbot_setup():
    err = login_required_page()
    if err: return err
    host = request.host
    script = f"""#!/bin/bash
# BlinkBot Setup Script
# Run this on your device after installing Ollama

set -e

SERVER="http://{host}"

echo ""
echo "=== BlinkBot Setup ==="
echo ""

echo "[1/3] Downloading BlinkBot model (~900MB)..."
curl -L "$SERVER/pug/download/blinkbot-model" -o ~/BlinkBot_1.5B.gguf
echo "Model saved to ~/BlinkBot_1.5B.gguf"

echo ""
echo "[2/3] Downloading Modelfile..."
curl -L "$SERVER/pug/download/blinkbot-modelfile" -o ~/BlinkbotModelfile

echo ""
echo "[3/3] Creating Ollama model..."
ollama create blinkbot -f ~/BlinkbotModelfile

echo ""
echo "=== Setup complete ==="
echo ""
echo "Now start Ollama with browser access:"
echo ""
echo "  OLLAMA_ORIGINS=\\"*\\" ollama serve"
echo ""
echo "Then refresh the Blankit page — BlinkBot will activate automatically."
echo ""
"""
    from flask import make_response
    r = make_response(script)
    r.headers['Content-Type']        = 'text/plain'
    r.headers['Content-Disposition'] = 'attachment; filename=setup_blinkbot.sh'
    return r


@pug_bp.route('/pug/install/blinkbot-model')
def install_blinkbot_model():
    """Public model download used by the one-liner install script (no browser session needed)."""
    from flask import send_file
    return send_file(
        _BLINK_PATH,
        as_attachment=True,
        download_name='BlinkBot_1.5B.gguf'
    )


@pug_bp.route('/pug/install/blinkbot')
def install_blinkbot():
    """
    One-liner installer served as a bash script.
    Usage: curl -fsSL http://<host>/pug/install/blinkbot | bash
    No auth required — this runs in the user's terminal, not the browser.
    """
    from flask import make_response
    host = request.host

    script = f'''#!/bin/bash
set -e

SERVER="http://{host}"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        BlinkBot Installer            ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# 1. Install Ollama if not present
if ! command -v ollama &>/dev/null; then
    echo "[1/4] Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    echo ""
else
    echo "[1/4] Ollama already installed — skipping"
fi

# 2. Download BlinkBot model
echo "[2/4] Downloading BlinkBot model (~900MB)..."
curl -L --progress-bar "$SERVER/pug/install/blinkbot-model" -o ~/BlinkBot_1.5B.gguf
echo "      Saved to ~/BlinkBot_1.5B.gguf"
echo ""

# 3. Create Ollama model from embedded Modelfile
echo "[3/4] Creating Ollama model..."
cat > /tmp/BlinkbotModelfile <<\'MFEOF\'
FROM ~/BlinkBot_1.5B.gguf

TEMPLATE """<|im_start|>system
{{{{ .System }}}}<|im_end|>
<|im_start|>user
{{{{ .Prompt }}}}<|im_end|>
<|im_start|>assistant
"""

PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"
PARAMETER num_ctx 4096
MFEOF
ollama create blinkbot -f /tmp/BlinkbotModelfile
rm -f /tmp/BlinkbotModelfile
echo "      blinkbot model created"
echo ""

# 4. Set up Ollama as a background service with CORS
echo "[4/4] Starting Ollama with CORS enabled..."
OS=$(uname -s)

if [[ "$OS" == "Linux" ]] && command -v systemctl &>/dev/null; then
    OVERRIDE_DIR="/etc/systemd/system/ollama.service.d"
    sudo mkdir -p "$OVERRIDE_DIR"
    printf "[Service]\\nEnvironment=OLLAMA_ORIGINS=*\\n" | sudo tee "$OVERRIDE_DIR/ollama-cors.conf" > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable ollama 2>/dev/null || true
    sudo systemctl restart ollama
    echo "      Ollama systemd service started with CORS enabled"

elif [[ "$OS" == "Darwin" ]]; then
    PLIST="$HOME/Library/LaunchAgents/com.blankit.ollama-cors.plist"
    cat > "$PLIST" <<\'PLISTEOF\'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.blankit.ollama-cors</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/ollama</string>
        <string>serve</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OLLAMA_ORIGINS</key><string>*</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
PLISTEOF
    pkill ollama 2>/dev/null || true
    sleep 1
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "      Ollama LaunchAgent installed with CORS enabled"

else
    pkill ollama 2>/dev/null || true
    sleep 1
    OLLAMA_ORIGINS="*" nohup ollama serve > /tmp/ollama.log 2>&1 &
    echo "      Ollama started in background (PID $!)"
fi

echo ""
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║  BlinkBot is ready!                              ║"
echo "  ║  Go back to the Blankit page — it will           ║"
echo "  ║  activate automatically within a few seconds.    ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""
'''

    r = make_response(script)
    r.headers['Content-Type']        = 'text/plain; charset=utf-8'
    r.headers['Content-Disposition'] = 'inline'
    return r