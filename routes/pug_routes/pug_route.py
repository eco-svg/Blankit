import os
import time
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Blueprint, render_template, request, jsonify, url_for, send_from_directory, session # Added session
from .extensions import db
from .notes import Note 
from dotenv import load_dotenv
from datetime import datetime, timedelta
import requests

# --- DYNAMIC PATH FINDER ---
current_dir = Path(__file__).resolve().parent 
root_dir = current_dir.parent.parent         
dotenv_path = root_dir / '.env'
load_dotenv(dotenv_path=dotenv_path)

CUSTOM_MEDIA_FOLDER = os.environ.get('BLANKIT_MEDIA_PATH', '/mnt/storage/blank_data/user_media')

pug_bp = Blueprint(
    'pug',
    __name__,
    template_folder='../../templates/pug_templates',
    static_folder='../../static/pug_style',
    static_url_path='/pug_style'
)

# --- HELPER: CHECK LOGIN ---
def get_current_user():
    return session.get('user_id')

# --- 0. HOME ROUTE ---
@pug_bp.route('/pug') # Explicit route to avoid clashing with the root index
def home():
    if not get_current_user():
        return jsonify({"error": "Please log in from the main page."}), 401
    return render_template('home.html')

# ==========================================
# --- 1. NOTES API ---
# ==========================================
@pug_bp.route('/api/notes', methods=['GET', 'POST'])
def handle_notes():
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    if request.method == 'GET':
        notes = Note.query.filter_by(user_id=user_id, entry_type='note', is_deleted=False).order_by(Note.updated_at.desc()).all()
        return jsonify([n.to_dict() for n in notes])

    if request.method == 'POST':
        data = request.get_json()
        note_id = data.get('id')
        
        if note_id:
            note = Note.query.filter_by(id=note_id, user_id=user_id).first()
            if note:
                note.title = data.get('title', '')
                note.body = data.get('body', '')
        else:
            note = Note(user_id=user_id, entry_type='note', title=data.get('title', ''), body=data.get('body', ''))
            db.session.add(note)
            
        db.session.commit()
        return jsonify({"status": "success", "id": note.id})

@pug_bp.route('/api/notes/<int:note_id>', methods=['DELETE'])
def soft_delete_note(note_id):
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    note = Note.query.filter_by(id=note_id, user_id=user_id).first()
    if note:
        note.is_deleted = True 
        db.session.commit()
        return jsonify({"status": "success"})
    return jsonify({"error": "Note not found"}), 404

# ==========================================
# --- 2. GOALS API ---
# ==========================================
@pug_bp.route('/api/goals', methods=['GET', 'POST'])
def handle_goals():
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    if request.method == 'GET':
        goals = Note.query.filter_by(user_id=user_id, entry_type='goal', is_deleted=False).order_by(Note.created_at.desc()).all()
        return jsonify([g.to_dict() for g in goals])

    if request.method == 'POST':
        data = request.get_json()
        new_goal = Note(user_id=user_id, entry_type='goal', title=data.get('title', ''))
        db.session.add(new_goal)
        db.session.commit()
        return jsonify({"status": "success"})

@pug_bp.route('/api/goals/<int:goal_id>', methods=['PATCH', 'DELETE'])
def modify_goal(goal_id):
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    goal = Note.query.filter_by(id=goal_id, user_id=user_id, entry_type='goal').first()
    if not goal:
        return jsonify({"error": "Not found"}), 404

    if request.method == 'PATCH':
        data = request.get_json()
        if 'is_finished' in data:
            goal.is_finished = data['is_finished']
        db.session.commit()
        return jsonify({"status": "success"})

    if request.method == 'DELETE':
        goal.is_deleted = True
        db.session.commit()
        return jsonify({"status": "success"})

# ==========================================
# --- 3. MEDIA API ---
# ==========================================
@pug_bp.route('/api/upload', methods=['POST'])
def upload_file():
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    file = request.files.get('file')
    if file:
        os.makedirs(CUSTOM_MEDIA_FOLDER, exist_ok=True)
        safe_name = secure_filename(file.filename)
        unique_filename = f"user_{user_id}_{int(time.time())}_{safe_name}"
        
        filepath = os.path.join(CUSTOM_MEDIA_FOLDER, unique_filename)
        file.save(filepath)
        
        file_url = url_for('pug.serve_media', filename=unique_filename)
        return jsonify({'url': file_url})
    return jsonify({'error': 'No file'}), 400

@pug_bp.route('/media/<filename>')
def serve_media(filename):
    # Depending on how secure you want this, you might check if the filename starts with f"user_{session['user_id']}_"
    return send_from_directory(CUSTOM_MEDIA_FOLDER, filename)

# ==========================================
# --- 4. CONSISTENCY API ---
# ==========================================
@pug_bp.route('/api/consistency', methods=['GET'])
def get_consistency():
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    today = datetime.utcnow().date()
    data = []
    
    for i in range(6, -1, -1):
        target_date = today - timedelta(days=i)
        
        added = Note.query.filter(
            Note.user_id == user_id, 
            Note.entry_type == 'goal',
            Note.is_deleted == False,
            db.func.date(Note.created_at) == target_date
        ).count()
        
        finished = Note.query.filter(
            Note.user_id == user_id,
            Note.entry_type == 'goal',
            Note.is_finished == True,
            Note.is_deleted == False,
            db.func.date(Note.updated_at) == target_date
        ).count()
        
        data.append({
            "day": target_date.strftime("%a"), 
            "added": added,
            "finished": finished
        })
        
    return jsonify(data)

# ==========================================
# --- 5. THE DREAM API ---
# ==========================================
@pug_bp.route('/api/dream', methods=['GET', 'POST'])
def handle_dream():
    user_id = get_current_user()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    if request.method == 'GET':
        dream = Note.query.filter_by(user_id=user_id, entry_type='dream', is_deleted=False).first()
        return jsonify({"dream": dream.title if dream else None})

    if request.method == 'POST':
        existing = Note.query.filter_by(user_id=user_id, entry_type='dream', is_deleted=False).first()
        if existing:
            return jsonify({"error": "Dream already locked in."}), 403

        data = request.get_json()
        new_dream = Note(user_id=user_id, entry_type='dream', title=data.get('title'))
        db.session.add(new_dream)
        db.session.commit()
        return jsonify({"status": "success", "dream": new_dream.title})

# ==========================================
# --- 6. THE AI ASK API ---
# ==========================================
@pug_bp.route('/api/ask', methods=['POST'])
def ask_ai():
    # The AI doesn't access the database, but we still ensure only logged-in users can burn your API credits!
    if not get_current_user(): return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    user_prompt = data.get('prompt', '')

    if not user_prompt:
        return jsonify({"reply": "I need a prompt to process."}), 400

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return jsonify({"reply": "System offline: GROQ_API_KEY missing from .env file."}), 500

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    
    payload = {
        "model": "llama-3.1-70b-versatile", 
        "messages": [
            {"role": "system", "content": "You are the AI brain embedded in a personal productivity dashboard called Blankit. You are concise, highly intelligent, and direct. Keep your answers relatively short unless asked to explain deeply, as you are displaying in a small web widget."},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 1024
    }

    try:
        response = requests.post(url, headers=headers, json=payload)
        response_data = response.json()
        
        if 'choices' in response_data and len(response_data['choices']) > 0:
            reply_text = response_data['choices'][0]['message']['content']
            return jsonify({"reply": reply_text})
        else:
            error_msg = response_data.get('error', {}).get('message', 'Unknown API Error')
            return jsonify({"reply": f"API Error: {error_msg}"})
            
    except Exception as e:
        print(f"AI API Error: {e}")
        return jsonify({"reply": "System offline: Could not connect to Groq mainframe."}), 500