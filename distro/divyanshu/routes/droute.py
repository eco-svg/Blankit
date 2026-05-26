from flask import Blueprint, render_template, session, redirect, url_for, request, jsonify
from functools import wraps
import os
from groq import Groq

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
@login_required
def ai_coach():
    data    = request.get_json()
    message = data.get('message', '').strip()
    mood    = data.get('mood', 'Normal')

    if not message:
        return jsonify({'error': 'No message provided'}), 400

    # DEBUG — print key info to terminal
    raw_key = os.getenv('GROQ_API_KEY', 'NOT FOUND')
    print(f"DEBUG key starts with: {raw_key[:8]}")
    print(f"DEBUG key length: {len(raw_key)}")
    print(f"DEBUG first char: {repr(raw_key[0])}")

    try:
        # Strip any accidental quotes from the key
        clean_key = raw_key.strip().strip('"').strip("'")
        print(f"DEBUG clean key starts with: {clean_key[:8]}")

        client = Groq(api_key=clean_key)

        response = client.chat.completions.create(
            model='llama-3.3-70b-versatile',
            messages=[
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
            max_tokens=150,
            temperature=0.8
        )

        reply = response.choices[0].message.content.strip()
        print(f"DEBUG Groq reply: {reply[:50]}")
        return jsonify({'reply': reply})

    except Exception as e:
        print(f"Groq API error FULL: {e}")
        return jsonify({
            'reply': "I'm having trouble connecting right now. Keep pushing — you've got this!"
        }), 200
