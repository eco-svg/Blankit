"""Assist: knowledge engine (Groq), bot stubs, BlinkBot model delivery,
weather/wisdom proxies, feedback email."""
import html as html_mod
import os
import re

from flask import Response, current_app, jsonify, request, session

from shared.extensions import limiter
from distro.pug.services.bot_prompts import BLINKBOT_SYSTEM
from distro.pug.services.sheet_ai import (assemble_user_context,
                                          build_context_block, groq_answer)
from . import pug_bp
from .guards import login_required, login_required_page

_DATA_DIR   = '/data' if os.path.isdir('/data') else os.path.join(
    os.path.dirname(__file__), '..', '..', '..', '..')
_MODELS_DIR = os.path.join(_DATA_DIR, 'distro', 'pug', 'llm')
_BLINK_PATH = os.environ.get('BLINKBOT_PATH',
                             os.path.join(_MODELS_DIR, 'blinkbot', 'BlinkBot_1.5Binal.Q4_K_M.gguf'))
_BUDDY_PATH = os.environ.get('BUDDYBOT_PATH',
                             os.path.join(_MODELS_DIR, 'buddybot', 'BuddyBot_8B_Final.Q4_K_M.gguf'))


# ── Knowledge engine ─────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/ask', methods=['POST'])
@limiter.limit("30 per minute")
@login_required
def ask():
    data  = request.get_json(silent=True) or {}
    query = (data.get('query') or '').strip()
    if not query:
        return jsonify({'error': 'Empty query'}), 400
    if len(query) > 2000:
        return jsonify({'error': 'Query too long'}), 400
    answer = groq_answer(query)
    if answer is None:
        return jsonify({'error': 'Knowledge engine unavailable'}), 503
    return jsonify({'answer': answer})


# ── Bot endpoints (rebuilding — stubbed) ─────────────────────────────────────

@pug_bp.route('/pug/api/blinkbot', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def blinkbot_chat():
    return jsonify({'answer': 'BlinkBot is being rebuilt — coming soon.', 'source': 'offline'}), 200


@pug_bp.route('/pug/api/buddybot', methods=['POST'])
@login_required
def buddybot_endpoint():
    return jsonify({'answer': 'BuddyBot is coming soon.', 'source': 'offline'}), 200


@pug_bp.route('/pug/api/blinkbot-context', methods=['GET'])
@login_required
def blinkbot_context():
    """Full system prompt with fresh user context for the local BlinkBot client."""
    user_context = assemble_user_context(session['user_id'], session.get('username', ''))
    ctx_block    = build_context_block(user_context)
    hf_url       = os.environ.get('BLINKBOT_MODEL_URL')
    model_url    = '/pug/install/blinkbot-model.gguf' if (hf_url or os.path.exists(_BLINK_PATH)) else None
    resp = jsonify({
        'system_prompt': BLINKBOT_SYSTEM + ctx_block,
        'user_context':  user_context,
        'model_url':     model_url,
    })
    resp.headers['Cache-Control'] = 'no-store'
    return resp


# ── BlinkBot model delivery (browser inference via wllama) ──────────────────

@pug_bp.route('/pug/install/blinkbot-model.gguf', methods=['GET', 'HEAD'])
@login_required_page
def install_blinkbot_model():
    """Serve the GGUF with range-request support so wllama can chunk the download."""
    from flask import send_file
    if not os.path.exists(_BLINK_PATH):
        return Response(status=404)
    file_size = os.path.getsize(_BLINK_PATH)

    if request.method == 'HEAD':
        return Response(status=200, headers={
            'Content-Type':   'application/octet-stream',
            'Content-Length': str(file_size),
            'Accept-Ranges':  'bytes',
        })

    range_header = request.headers.get('Range')
    if range_header:
        try:
            byte_range = range_header.replace('bytes=', '').split('-')
            start  = int(byte_range[0])
            end    = int(byte_range[1]) if byte_range[1] else file_size - 1
            length = end - start + 1

            def chunk_gen():
                with open(_BLINK_PATH, 'rb') as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        data = f.read(min(65536, remaining))
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
            return Response(chunk_gen(), status=206, headers={
                'Content-Type':   'application/octet-stream',
                'Content-Range':  f'bytes {start}-{end}/{file_size}',
                'Content-Length': str(length),
                'Accept-Ranges':  'bytes',
            })
        except Exception:
            pass  # fall through to full file

    resp = send_file(_BLINK_PATH, mimetype='application/octet-stream', conditional=True)
    resp.headers['Accept-Ranges'] = 'bytes'
    return resp


# ── MLC weight proxy (HF token stays server-side) ────────────────────────────

_MLC_HF_BASE  = 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
_MLC_LIB_BASE = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_83/base'
_MLC_SAFE_PATH = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._\-/]*$')


def _mlc_path_ok(p):
    return bool(_MLC_SAFE_PATH.match(p)) and '..' not in p and '//' not in p


def _stream_proxy(upstream_url):
    import requests as req
    from flask import stream_with_context
    headers = {}
    if 'Range' in request.headers:
        headers['Range'] = request.headers['Range']
    r = req.get(upstream_url, headers=headers, stream=True, timeout=120)
    resp_headers = {'Content-Type': r.headers.get('Content-Type', 'application/octet-stream')}
    for h in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
        if h in r.headers:
            resp_headers[h] = r.headers[h]

    def gen():
        for chunk in r.iter_content(chunk_size=65536):
            yield chunk

    return Response(stream_with_context(gen()), status=r.status_code, headers=resp_headers)


@pug_bp.route('/pug/mlc-weights/<path:filepath>')
@login_required
def proxy_mlc_weights(filepath):
    if not _mlc_path_ok(filepath):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        return _stream_proxy(f'{_MLC_HF_BASE}/{filepath}')
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@pug_bp.route('/pug/mlc-lib/<path:filename>')
@login_required
def proxy_mlc_lib(filename):
    if not _mlc_path_ok(filename):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        return _stream_proxy(f'{_MLC_LIB_BASE}/{filename}')
    except Exception as e:
        return jsonify({'error': str(e)}), 502


# ── Weather / wisdom proxies ─────────────────────────────────────────────────

@pug_bp.route('/pug/api/weather', methods=['GET'])
@login_required
def proxy_weather():
    import requests as req
    try:
        lat = float(request.args.get('lat', '30.7333'))
        lon = float(request.args.get('lon', '76.7794'))
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            raise ValueError('out of range')
    except (ValueError, TypeError):
        return jsonify({'error': 'invalid coordinates'}), 400
    try:
        r = req.get(
            f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true',
            timeout=8,
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        current_app.logger.error(f'[proxy_weather] {type(e).__name__}: {e}')
        return jsonify({'error': 'unavailable'}), 502


@pug_bp.route('/pug/api/wisdom', methods=['GET'])
@login_required
def proxy_wisdom():
    import random
    import requests as req
    try:
        if random.random() > 0.5:
            r = req.get('https://uselessfacts.jsph.pl/api/v2/facts/random', timeout=8)
            r.raise_for_status()
            return jsonify({'text': r.json().get('text', '')})
        r = req.get('https://dummyjson.com/quotes/random', timeout=8)
        r.raise_for_status()
        d = r.json()
        q, a = d.get('quote', ''), d.get('author', '')
        if not q:
            raise ValueError('empty quote')
        return jsonify({'text': f'"{q}" — {a}'})
    except Exception:
        return jsonify({'error': 'unavailable'}), 502


# ── Feedback / reports / gift cards ──────────────────────────────────────────

@pug_bp.route('/pug/api/feedback', methods=['POST'])
@limiter.limit("10 per hour")
@login_required
def submit_feedback():
    data    = request.get_json(silent=True) or {}
    kind    = data.get('kind', 'general')   # 'feature' | 'report' | 'giftcard'
    rtype   = data.get('rtype', '')          # bug / content / other (reports only)
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'error': 'Message is empty'}), 400

    from shared.auth.user import User
    from shared.extensions import db
    user       = db.session.get(User, session['user_id'])
    user_email = user.email if user else 'unknown'
    username   = session.get('username', 'Unknown')

    # Escape all user-controlled values before inserting into the HTML email
    s_username   = html_mod.escape(username)
    s_user_email = html_mod.escape(user_email)
    s_message    = html_mod.escape(message)

    if kind == 'feature':
        subject, heading = f'[Veyra Feature Request] {username}', 'Feature Request'
    elif kind == 'giftcard':
        subject, heading = f'[Veyra Gift Card] {username}', 'Amazon Pay Gift Card'
    else:
        tag = f' — {rtype.title()}' if rtype else ''
        subject, heading = f'[Veyra Report{tag}] {username}', f'Report{tag}'

    email_html = f"""
    <h2 style="font-family:sans-serif;">{heading}</h2>
    <table style="font-family:sans-serif;font-size:14px;">
      <tr><td><b>User</b></td><td>{s_username}</td></tr>
      <tr><td><b>Email</b></td><td>{s_user_email}</td></tr>
      <tr><td><b>Distro</b></td><td>Ocellus</td></tr>
    </table>
    <hr>
    <p style="font-family:sans-serif;font-size:15px;white-space:pre-wrap;">{s_message}</p>
    """

    try:
        from shared.auth.auth_route import _send_email
        _send_email('veyrasupportus@gmail.com', subject, email_html)
        return jsonify({'status': 'sent'})
    except Exception as e:
        current_app.logger.error(f'[feedback] send error: {e}')
        return jsonify({'error': 'Failed to send — try again later'}), 500
