import os
import time
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Blueprint, render_template, request, jsonify, url_for, send_from_directory
from .extensions import db
from .notes import Note 
from dotenv import load_dotenv
from datetime import datetime, timedelta

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

# --- 0. HOME ROUTE ---
@pug_bp.route('/')
def home():
    return render_template('home.html')

# ==========================================
# --- 1. NOTES API (Filtered by entry_type) ---
# ==========================================
@pug_bp.route('/api/notes', methods=['GET', 'POST'])
def handle_notes():
    if request.method == 'GET':
        # ONLY grab entries where entry_type == 'note'
        notes = Note.query.filter_by(user_id=1, entry_type='note', is_deleted=False).order_by(Note.updated_at.desc()).all()
        return jsonify([n.to_dict() for n in notes])

    if request.method == 'POST':
        data = request.get_json()
        note_id = data.get('id')
        
        if note_id:
            note = Note.query.filter_by(id=note_id, user_id=1).first()
            if note:
                note.title = data.get('title', '')
                note.body = data.get('body', '')
        else:
            # Stamp new flows as 'note'
            note = Note(user_id=1, entry_type='note', title=data.get('title', ''), body=data.get('body', ''))
            db.session.add(note)
            
        db.session.commit()
        return jsonify({"status": "success", "id": note.id})

@pug_bp.route('/api/notes/<int:note_id>', methods=['DELETE'])
def soft_delete_note(note_id):
    note = Note.query.filter_by(id=note_id, user_id=1).first()
    if note:
        note.is_deleted = True 
        db.session.commit()
        return jsonify({"status": "success"})
    return jsonify({"error": "Note not found"}), 404

# ==========================================
# --- 2. GOALS API (Filtered by entry_type) ---
# ==========================================
@pug_bp.route('/api/goals', methods=['GET', 'POST'])
def handle_goals():
    if request.method == 'GET':
        # ONLY grab entries where entry_type == 'goal'
        goals = Note.query.filter_by(user_id=1, entry_type='goal', is_deleted=False).order_by(Note.created_at.desc()).all()
        return jsonify([g.to_dict() for g in goals])

    if request.method == 'POST':
        data = request.get_json()
        # Stamp new goals as 'goal'
        new_goal = Note(user_id=1, entry_type='goal', title=data.get('title', ''))
        db.session.add(new_goal)
        db.session.commit()
        return jsonify({"status": "success"})

@pug_bp.route('/api/goals/<int:goal_id>', methods=['PATCH', 'DELETE'])
def modify_goal(goal_id):
    goal = Note.query.filter_by(id=goal_id, user_id=1, entry_type='goal').first()
    if not goal:
        return jsonify({"error": "Not found"}), 404

    # PATCH flips the switch to Finished
    if request.method == 'PATCH':
        data = request.get_json()
        if 'is_finished' in data:
            goal.is_finished = data['is_finished']
        db.session.commit()
        return jsonify({"status": "success"})

    # DELETE soft-deletes the goal just like a note
    if request.method == 'DELETE':
        goal.is_deleted = True
        db.session.commit()
        return jsonify({"status": "success"})

# ==========================================
# --- 3. MEDIA API ---
# ==========================================
@pug_bp.route('/api/upload', methods=['POST'])
def upload_file():
    file = request.files.get('file')
    if file:
        os.makedirs(CUSTOM_MEDIA_FOLDER, exist_ok=True)
        
        user_id = 1 
        safe_name = secure_filename(file.filename)
        unique_filename = f"user_{user_id}_{int(time.time())}_{safe_name}"
        
        filepath = os.path.join(CUSTOM_MEDIA_FOLDER, unique_filename)
        file.save(filepath)
        
        file_url = url_for('pug.serve_media', filename=unique_filename)
        return jsonify({'url': file_url})
    return jsonify({'error': 'No file'}), 400

@pug_bp.route('/api/consistency', methods=['GET'])
def get_consistency():
    today = datetime.utcnow().date()
    data = []
    
    # We will generate data for the last 7 days (including today)
    for i in range(6, -1, -1):
        target_date = today - timedelta(days=i)
        
        # 1. Count goals ADDED on this date
        added = Note.query.filter(
            Note.user_id == 1, 
            Note.entry_type == 'goal',
            Note.is_deleted == False,
            db.func.date(Note.created_at) == target_date
        ).count()
        
        # 2. Count goals FINISHED on this date
        # (If it is finished, its updated_at timestamp is when you clicked the button)
        finished = Note.query.filter(
            Note.user_id == 1,
            Note.entry_type == 'goal',
            Note.is_finished == True,
            Note.is_deleted == False,
            db.func.date(Note.updated_at) == target_date
        ).count()
        
        data.append({
            "day": target_date.strftime("%a"), # Returns 'Mon', 'Tue', etc.
            "added": added,
            "finished": finished
        })
        
    return jsonify(data)
    # ==========================================
# --- 5. THE DREAM API (One-Shot) ---
# ==========================================
@pug_bp.route('/api/dream', methods=['GET', 'POST'])
def handle_dream():
    if request.method == 'GET':
        dream = Note.query.filter_by(user_id=1, entry_type='dream', is_deleted=False).first()
        return jsonify({"dream": dream.title if dream else None})

    if request.method == 'POST':
        # Check if they already set one!
        existing = Note.query.filter_by(user_id=1, entry_type='dream', is_deleted=False).first()
        if existing:
            return jsonify({"error": "Dream already locked in."}), 403

        data = request.get_json()
        new_dream = Note(user_id=1, entry_type='dream', title=data.get('title'))
        db.session.add(new_dream)
        db.session.commit()
        return jsonify({"status": "success", "dream": new_dream.title})

@pug_bp.route('/media/<filename>')
def serve_media(filename):
    return send_from_directory(CUSTOM_MEDIA_FOLDER, filename)