"""
distro/svg/routes/ai_route.py — svg's AI features (the `ai` blueprint, prefix /ai).

Three Groq-powered endpoints: suggest daily habits from a goal, a home-card "insight", and
a coaching chat. All of them build a small summary of the user's recent habit data
(get_habit_context) and send it to Groq with a tailored system prompt. The Groq API key
stays server-side; the model's JSON replies are parsed defensively (parse_json_array).
"""
import re
import json
import os
import requests
from dotenv import load_dotenv
from flask import Blueprint, request, jsonify, session, current_app
from distro.svg.models.habit import Habit
from distro.svg.models.habit_log import HabitLog
from shared.extensions import limiter
from datetime import date, timedelta

load_dotenv()

ai = Blueprint('ai', __name__, url_prefix='/ai')

GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_MODEL = 'llama-3.1-8b-instant'


def call_groq(prompt: str, system: str = '') -> str:
    """Send a prompt (with optional system message) to Groq and return the reply text. Raises RuntimeError on any failure."""
    api_key = os.environ.get('SVG_GROQ_API_KEY')
    if not api_key:
        raise RuntimeError('Something went wrong... Must be vibe coaded')

    messages = []
    if system:
        messages.append({'role': 'system', 'content': system})
    messages.append({'role': 'user', 'content': prompt})

    try:
        r = requests.post(
            GROQ_URL,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type':  'application/json',
            },
            json={
                'model':       GROQ_MODEL,
                'messages':    messages,
                'max_tokens':  1024,
                'temperature': 0.7,
            },
            timeout=30,
        )
        r.raise_for_status()
        return r.json()['choices'][0]['message']['content'].strip()
    except requests.exceptions.ConnectionError:
        raise RuntimeError('Could not reach Groq API — check your internet connection.')
    except requests.exceptions.HTTPError:
        raise RuntimeError(f'Groq API error {r.status_code}: {r.text}')
    except Exception as e:
        raise RuntimeError(f'Groq error: {e}')


def parse_json_array(raw: str):
    """Robustly extract a JSON array from model output."""
    raw = raw.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*',     '', raw)
    raw = re.sub(r'\s*```$',     '', raw)
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and 'habits' in parsed:
            parsed = parsed['habits']
        if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], list):
            parsed = parsed[0]
        return parsed, None
    except json.JSONDecodeError:
        pass

    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
            return parsed, None
        except json.JSONDecodeError:
            pass

    return None, raw


def login_required_api():
    """Guard for /ai endpoints: return a 401/403 JSON error unless a logged-in Eco-Svg user; None if OK."""
    if not session.get('user_id'):
        return jsonify({'error': 'not logged in'}), 401
    if session.get('distro') != 'Eco-Svg':
        return jsonify({'error': 'forbidden'}), 403
    return None


def get_habit_context(user_id: int) -> str:
    """Build a short text summary of the user's last-30-day completion rate per habit, fed to the AI as context."""
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
@limiter.limit("10 per minute")
def suggest_habits():
    """POST /ai/suggest-habits — ask the AI for 5 small daily habits for a given goal (returns a JSON array)."""
    err = login_required_api()
    if err: return err

    data = request.get_json()
    goal = data.get('goal', '').strip()
    if not goal:
        return jsonify({'error': 'goal is required'}), 400
    if len(goal) > 500:
        return jsonify({'error': 'Goal too long (max 500 chars)'}), 400

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
        raw = call_groq(prompt, system)
        current_app.logger.info(f'Groq RAW: {repr(raw[:400])}')
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
@limiter.limit("10 per minute")
def insight():
    """GET /ai/insight — one short, personalised coaching insight for the home card."""
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
        return jsonify({'insight': call_groq(prompt, system)})
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503


# ══════════════════════════════
#  CHAT
#  POST /ai/chat
# ══════════════════════════════
@ai.route('/chat', methods=['POST'])
@limiter.limit("15 per minute")
def chat():
    """POST /ai/chat — a coaching reply to the user message, grounded in their habit data."""
    err = login_required_api()
    if err: return err

    data    = request.get_json()
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'error': 'message required'}), 400
    if len(message) > 1000:
        return jsonify({'error': 'Message too long (max 1000 chars)'}), 400

    context = get_habit_context(session['user_id'])

    system = (
        'You are VEYRA, a personal atomic habits coach inside the Eco-Svg app. '
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
        return jsonify({'reply': call_groq(prompt, system)})
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503