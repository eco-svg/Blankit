import re
import json
import requests
from flask import Blueprint, request, jsonify, session, current_app
from distro.svg.models.habit import Habit
from distro.svg.models.habit_log import HabitLog
from datetime import date, timedelta

ai = Blueprint('ai', __name__, url_prefix='/ai')

OLLAMA_URL   = 'http://localhost:11434/api/generate'
OLLAMA_MODEL = 'llama3.2'


def ollama(prompt: str, system: str = '') -> str:
    payload = {'model': OLLAMA_MODEL, 'prompt': prompt, 'stream': False}
    if system:
        payload['system'] = system
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=90)
        r.raise_for_status()
        return r.json().get('response', '').strip()
    except requests.exceptions.ConnectionError:
        raise RuntimeError('Ollama is not running. Start it: ollama serve')
    except Exception as e:
        raise RuntimeError(f'Ollama error: {e}')


def parse_json_array(raw: str):
    """Robustly extract a JSON array from model output."""
    # strip markdown fences
    raw = raw.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*',     '', raw)
    raw = re.sub(r'\s*```$',     '', raw)
    raw = raw.strip()

    # try direct parse
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and 'habits' in parsed:
            parsed = parsed['habits']
        if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], list):
            parsed = parsed[0]
        return parsed, None
    except json.JSONDecodeError:
        pass

    # try extracting first [...] block
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
            return parsed, None
        except json.JSONDecodeError:
            pass

    return None, raw


def login_required_api():
    if not session.get('user_id'):
        return jsonify({'error': 'not logged in'}), 401
    if session.get('distro') != 'ecosvg':
        return jsonify({'error': 'forbidden'}), 403
    return None


def get_habit_context(user_id: int) -> str:
    habits = Habit.query.filter_by(user_id=user_id).all()
    if not habits:
        return 'No habits yet.'
    today = date.today()
    lines = []
    for h in habits:
        logs  = HabitLog.query.filter(
            HabitLog.habit_id == h.id,
            HabitLog.date >= today - timedelta(days=30)
        ).all()
        done  = len([l for l in logs if l.done])
        total = len(logs)
        rate  = round(done / total * 100) if total else 0
        lines.append(f'- {h.name}: {rate}% completion rate over last 30 days')
    return '\n'.join(lines)


# ══════════════════════════════
#  SUGGEST HABITS FROM GOAL
#  POST /ai/suggest-habits
# ══════════════════════════════
@ai.route('/suggest-habits', methods=['POST'])
def suggest_habits():
    err = login_required_api()
    if err: return err

    data = request.get_json()
    goal = data.get('goal', '').strip()
    if not goal:
        return jsonify({'error': 'goal is required'}), 400

    existing = get_habit_context(session['user_id'])

    system = (
        'You are an atomic habits coach. '
        'Return ONLY a valid JSON array — no explanation, no markdown, no backticks, no extra text. '
        'Suggest 5 small trackable daily habits for the given goal. '
        'Each habit must be something that can be ticked off daily (e.g. "Practice chess puzzles for 10 min"). '
        'JSON format: [{"habit": "...", "why": "one sentence", "frequency": "daily", "duration": "10 min"}]'
    )

    prompt = (
        f'Goal: {goal}\n'
        f'Existing habits:\n{existing}\n\n'
        'Return only the JSON array of 5 atomic habits. Nothing else.'
    )

    try:
        raw    = ollama(prompt, system)
        current_app.logger.error(f'RAW: {repr(raw[:400])}')
        parsed, fallback = parse_json_array(raw)

        if parsed:
            return jsonify({'habits': parsed, 'goal': goal})
        else:
            return jsonify({'habits': None, 'raw': fallback, 'goal': goal})

    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503


# ══════════════════════════════
#  AI INSIGHT (home card)
#  GET /ai/insight
# ══════════════════════════════
@ai.route('/insight', methods=['GET'])
def insight():
    err = login_required_api()
    if err: return err

    context = get_habit_context(session['user_id'])

    system = (
        'You are a concise habit coach. '
        'Give ONE short, specific, actionable insight (2-3 sentences). '
        'Be direct and encouraging. No bullet points. No markdown. Plain text only.'
    )
    prompt = (
        f"User's habits (last 30 days):\n{context}\n\n"
        "Give one personalised insight or suggestion to help them improve."
    )

    try:
        return jsonify({'insight': ollama(prompt, system)})
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503


# ══════════════════════════════
#  CHAT
#  POST /ai/chat
# ══════════════════════════════
@ai.route('/chat', methods=['POST'])
def chat():
    err = login_required_api()
    if err: return err

    data    = request.get_json()
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'error': 'message required'}), 400

    context = get_habit_context(session['user_id'])

    system = (
        'You are VEYRA, a personal atomic habits coach inside the ecosvg app. '
        'Your job is to help the user succeed at their habits — especially when they are struggling. '
        'When someone says they cannot do something (e.g. cannot run 3km), '
        'apply the 2-minute rule and habit scaling from Atomic Habits: '
        'suggest a smaller, easier version they CAN do right now, then build up gradually. '
        'Always be encouraging, specific, and practical. '
        'Reference their actual habit data when relevant. '
        'No markdown. Plain text only. Under 5 sentences unless asked for more.'
    )
    prompt = f"User habit data:\n{context}\n\nUser message: {message}"

    try:
        return jsonify({'reply': ollama(prompt, system)})
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503