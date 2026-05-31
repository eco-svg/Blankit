from flask import Blueprint, render_template, session, redirect, url_for, request, jsonify
from functools import wraps
import os
import requests as http
from shared.extensions import limiter

catalystcrew_bp = Blueprint(
    'catalystcrew', __name__,
    static_folder='../static',
    static_url_path='/static/catalystcrew_style',
    template_folder='../templates',
)

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user_id'):
            return redirect(url_for('svg.login'))
        if session.get('distro') != 'CatalystCrew':
            return redirect(url_for('svg.login'))
        return f(*args, **kwargs)
    return decorated

def get_user():
    return {
        'username': session.get('username', ''),
        'distro':   session.get('distro', 'CatalystCrew'),
        'user_id':  session.get('user_id'),
    }


@catalystcrew_bp.route('/d/home')
@login_required
def home():
    user = get_user()
    return render_template('divyanshu/home.html', username=user['username'])

@catalystcrew_bp.route('/d/habit-tracker')
@login_required
def habit_tracker():
    user = get_user()
    return render_template('divyanshu/home.html', username=user['username'])

# ══════════════════════════════════════════════
#  AI COACH — Groq API endpoint
# ══════════════════════════════════════════════
@catalystcrew_bp.route('/d/api/coach', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
def ai_coach():
    data    = request.get_json()
    message = data.get('message', '').strip()
    mood    = data.get('mood', 'Normal')

    if not message:
        return jsonify({'error': 'No message provided'}), 400
    if len(message) > 500:
        return jsonify({'error': 'Message too long (max 500 chars)'}), 400

    api_key = os.getenv('CC_GROQ_API_KEY', '').strip()
    if not api_key:
        print('[coach] CC_GROQ_API_KEY not set')
        return jsonify({'reply': "Coach is offline — API key not configured."}), 200

    try:
        resp = http.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type':  'application/json',
            },
            json={
                'model': 'llama-3.3-70b-versatile',
                'messages': [
                    {
                        'role': 'system',
                        'content': (
                            'You are an AI habit coach called Coach inside a habit tracking app. '
                            'Be motivational, direct, and personalized. '
                            'Reply in 2-3 sentences maximum. '
                            'Do not use asterisks or markdown formatting.'
                        )
                    },
                    {
                        'role': 'user',
                        'content': f'I am feeling {mood}. {message}'
                    }
                ],
                'max_tokens': 150,
                'temperature': 0.8,
            },
            timeout=20,
        )
        resp.raise_for_status()
        reply = resp.json()['choices'][0]['message']['content'].strip()
        return jsonify({'reply': reply})

    except Exception as e:
        print(f'[coach] Groq error: {e}')
        return jsonify({'reply': "I'm having trouble connecting right now. Keep pushing — you've got this!"}), 200
