import os
import re
import uuid
import io
import time
import json
import math
from datetime import datetime, timedelta
from flask import (
    Blueprint, render_template, request,
    jsonify, session, redirect, url_for, current_app, Response
)
from minio import Minio
from minio.error import S3Error
from werkzeug.utils import secure_filename
from shared.extensions import db
from .notes import Note
from .bot_prompts import BLINKBOT_SYSTEM, BUDDYBOT_SYSTEM
from shared.extensions import limiter

try:
    from llama_cpp import Llama
    _LLAMA_OK = True
except ImportError:
    _LLAMA_OK = False

_DATA_DIR   = '/data' if os.path.isdir('/data') else os.path.join(os.path.dirname(__file__), '..', '..', '..', '..')
_MODELS_DIR = os.path.join(_DATA_DIR, 'distro', 'pug', 'llm')
_BLINK_PATH = os.environ.get('BLINKBOT_PATH', os.path.join(_MODELS_DIR, 'blinkbot', 'BlinkBot_1.5Binal.Q4_K_M.gguf'))
_BUDDY_PATH = os.environ.get('BUDDYBOT_PATH', os.path.join(_MODELS_DIR, 'buddybot', 'BuddyBot_8B_Final.Q4_K_M.gguf'))

_blinkbot_model  = None
_buddybot_model  = None
_BUDDYBOT_ENABLED   = os.environ.get('BUDDYBOT_ENABLED',        'false').lower() == 'true'
_local_inf_env      = os.environ.get('ENABLE_LOCAL_INFERENCE',  'auto').lower()
_LOCAL_INFERENCE    = (_LLAMA_OK and os.path.exists(_BLINK_PATH)) if _local_inf_env == 'auto' else (_local_inf_env == 'true')


def _get_blinkbot():
    global _blinkbot_model
    if _blinkbot_model is None:
        _blinkbot_model = Llama(
            model_path=_BLINK_PATH,
            n_ctx=2048,
            n_threads=min(os.cpu_count() or 2, 2),
            chat_format='chatml',
            verbose=False,
            use_mlock=False,
        )
    return _blinkbot_model


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
    from shared.auth.user import User
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

    # Habits — active habits with 30-day log window
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    from collections import defaultdict

    today      = datetime.utcnow().date()
    thirty_ago = today - timedelta(days=30)

    habits    = Habit.query.filter_by(user_id=user_id, is_active=True).all()
    habit_summaries = []
    if habits:
        habit_ids = [h.id for h in habits]
        logs = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date >= thirty_ago
        ).all()
        logs_by_habit = defaultdict(dict)
        for lg in logs:
            logs_by_habit[lg.habit_id][lg.date] = lg.done
        for h in habits:
            ld       = logs_by_habit[h.id]
            done_7   = sum(1 for i in range(7) if ld.get(today - timedelta(days=i), False))
            streak   = 0
            chk      = today
            while chk >= thirty_ago and ld.get(chk, False):
                streak += 1
                chk -= timedelta(days=1)
            habit_summaries.append({
                'name':       h.name,
                'done_today': bool(ld.get(today, False)),
                'done_7':     done_7,
                'streak':     streak,
            })

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
        ],
        'habits': habit_summaries,
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

    lines.append('')
    lines.append('Habits (active):')
    if ctx.get('habits'):
        for h in ctx['habits']:
            tick = '✓' if h['done_today'] else '✗'
            lines.append(f"  {tick} {h['name']}: {h['done_7']}/7 this week, streak {h['streak']}d")
    else:
        lines.append('  None tracked yet')

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


_STOP_WORDS = {
    'the','a','an','is','it','to','of','and','or','in','on','at',
    'i','my','me','you','we','do','did','was','are','have','has',
    'be','this','that','what','how','why','who','when','where',
    'can','will','would','should','could','just','really','very',
}


def _parse_chat_log(log_text):
    """Parse decrypted chat log into a list of {date, user, bot} dicts."""
    exchanges = []
    current_date = ''
    pending_user = None
    for line in log_text.split('\n'):
        line = line.rstrip()
        if line.startswith('_____') and line.endswith('_____:'):
            current_date = line.strip('_:').strip()
        elif '] You: ' in line:
            pending_user = line.split('] You: ', 1)[-1]
        elif '] BlinkBot: ' in line and pending_user is not None:
            bot_msg = line.split('] BlinkBot: ', 1)[-1]
            exchanges.append({'date': current_date, 'user': pending_user, 'bot': bot_msg})
            pending_user = None
    return exchanges


def _search_chat_history(user_id, query, max_results=6):
    """
    Keyword search through the full persistent chat log.
    Returns the top-N most relevant exchanges regardless of age.
    """
    from .chat_logger import read_user_log
    log = read_user_log(user_id)
    if not log:
        return []

    exchanges = _parse_chat_log(log)
    if not exchanges:
        return []

    query_words = set(query.lower().split()) - _STOP_WORDS
    if not query_words:
        return []

    scored = []
    for ex in exchanges:
        combined = (ex['user'] + ' ' + ex['bot']).lower()
        score = sum(1 for w in query_words if w in combined)
        if score > 0:
            scored.append((score, ex))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [ex for _, ex in scored[:max_results]]


def _format_memory_block(exchanges):
    """Format relevant past exchanges as a context block for the prompt."""
    if not exchanges:
        return ''
    lines = ['RELEVANT PAST CONVERSATIONS (from memory):']
    for ex in exchanges:
        lines.append(f"[{ex['date']}] You: {ex['user']}")
        lines.append(f"              BlinkBot: {ex['bot']}")
    return '\n'.join(lines)


def _groq_search(query):
    import requests as req
    api_key = os.environ.get('PUG_GROQ_API_KEY', '')
    if not api_key:
        return None
    try:
        r = req.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': 'llama-3.1-8b-instant',
                'messages': [
                    {'role': 'system', 'content': 'You are a concise knowledge assistant. Answer factually and briefly.'},
                    {'role': 'user',   'content': query}
                ],
                'max_tokens': 400
            },
            timeout=10
        )
        if r.ok:
            return r.json()['choices'][0]['message']['content']
    except Exception:
        pass
    return None


def _call_groq_chat(message, session_history, user_context, user_id=None):
    import requests as req
    api_key = os.environ.get('PUG_GROQ_API_KEY', '')
    if not api_key:
        return None

    ctx_lines = [
        '────────────────────────────────────────',
        'USER CONTEXT',
        '────────────────────────────────────────',
        f'Username     : {user_context["username"]}',
        f'Member since : {user_context["member_since"]}',
        f'Dream        : {user_context["dream"] or "Not set"}',
        '', 'Active Goals:',
    ]
    for g in user_context['active_goals'] or ['None']:
        ctx_lines.append(f'  - {g}')
    ctx_lines += ['', 'Completed Goals (last 7 days):']
    for g in user_context['finished_this_week'] or ['None']:
        ctx_lines.append(f'  - {g}')
    ctx_lines += ['', 'Recent Note Titles:']
    for n in user_context['recent_notes'] or []:
        ctx_lines.append(f'  [{n["date"]}] {n["title"]}')
    if not user_context['recent_notes']:
        ctx_lines.append('  None')

    ctx_lines += ['', 'Habits (active):']
    for h in user_context.get('habits') or []:
        tick = '✓' if h['done_today'] else '✗'
        ctx_lines.append(f"  {tick} {h['name']}: {h['done_7']}/7 this week, streak {h['streak']}d")
    if not user_context.get('habits'):
        ctx_lines.append('  None tracked yet')

    # Search persistent chat log for relevant past exchanges
    if user_id:
        relevant = _search_chat_history(user_id, message)
        memory_block = _format_memory_block(relevant)
        if memory_block:
            ctx_lines += ['', memory_block]

    ctx_lines.append('────────────────────────────────────────')

    # Groq's llama-3.3-70b doesn't natively use <think> tags — it outputs reasoning as prose.
    # Force a [REPLY] marker so we can reliably split off preamble.
    groq_override = (
        "MANDATORY FORMAT: Before your response to the user, you may think internally. "
        "Then write the token [REPLY] on its own line, followed immediately by your response. "
        "ONLY the text after [REPLY] is shown to the user. "
        "If you write analysis, context-checking, or any reasoning before [REPLY], it is discarded. "
        "Example:\n[REPLY]\nYour actual response here.\n\n"
    )
    messages = [{'role': 'system', 'content': groq_override + BUDDYBOT_SYSTEM + '\n\n' + '\n'.join(ctx_lines)}]
    for h in (session_history or [])[-10:]:
        if h.get('role') in ('user', 'assistant') and h.get('content'):
            messages.append({'role': h['role'], 'content': h['content']})
    messages.append({'role': 'user', 'content': message})

    try:
        r = req.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={'model': 'llama-3.3-70b-versatile', 'messages': messages,
                  'max_tokens': 600, 'temperature': 0.7},
            timeout=30
        )
        if r.ok:
            raw   = r.json()['choices'][0]['message']['content']
            clean = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
            # Extract everything after [REPLY] marker; fall back to full clean if missing
            if '[REPLY]' in clean:
                clean = clean.split('[REPLY]', 1)[-1].strip()
            return clean or raw.strip()
        if r.status_code == 400:
            # Groq content filter — return a neutral message rather than 503
            return "That one's outside what I can work with on this channel. BuddyBot handles it — coming soon."
        current_app.logger.error(f"Groq chat {r.status_code}: {r.text[:200]}")
    except Exception as e:
        current_app.logger.error(f"Groq chat error: {e}")
    return None


def _call_buddybot(context_packet, user_context):
    ctx_line = (
        f"Username: {user_context['username']}, "
        f"Member since: {user_context['member_since']}, "
        f"Dream: {user_context['dream'] or 'not set'}, "
        f"Active Goals: {', '.join(user_context['active_goals']) or 'none'}."
    )
    user_msg = f"[CONTEXT] {ctx_line}\n\n{context_packet}"

    model    = _get_buddybot()
    messages = [
        {'role': 'system', 'content': BUDDYBOT_SYSTEM},
        {'role': 'user',   'content': user_msg}
    ]

    raw = ''
    for _ in range(3):  # max 3 groq search iterations
        out = model.create_chat_completion(
            messages=messages,
            max_tokens=600,
            temperature=0.7,
            stop=['<|im_end|>', '</s>']
        )
        raw = out['choices'][0]['message']['content']

        search_match = re.search(r'<groq_search>(.*?)</groq_search>', raw, re.DOTALL)
        if not search_match:
            break

        query  = search_match.group(1).strip()
        result = _groq_search(query)
        if not result:
            break

        messages.append({'role': 'assistant', 'content': raw})
        messages.append({
            'role': 'user',
            'content': f'[SEARCH RESULT for "{query}"]\n{result}\n\nNow answer the original question using this information.'
        })

    clean = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL)
    clean = re.sub(r'<groq_search>.*?</groq_search>', '', clean, flags=re.DOTALL)
    return clean.strip()

def _call_blinkbot_server(message, session_history, user_context, user_id=None):
    ctx_block = _build_context_block(user_context)

    if user_id:
        relevant     = _search_chat_history(user_id, message)
        memory_block = _format_memory_block(relevant)
        if memory_block:
            ctx_block += '\n\n' + memory_block

    model    = _get_blinkbot()
    messages = [{'role': 'system', 'content': BLINKBOT_SYSTEM + ctx_block}]
    for h in (session_history or [])[-8:]:
        if h.get('role') in ('user', 'assistant') and h.get('content'):
            messages.append({'role': h['role'], 'content': h['content']})
    messages.append({'role': 'user', 'content': message})

    out   = model.create_chat_completion(
        messages=messages,
        max_tokens=512,
        temperature=0.7,
        stop=['<|im_end|>', '</s>'],
    )
    raw   = out['choices'][0]['message']['content']
    clean = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
    clean = re.sub(r'<tool_call>.*?</tool_call>', '', clean, flags=re.DOTALL).strip()
    return clean


_stats_cache = {}  # in-memory fallback only


def _get_cached_sheet(user_id):
    """Read stats sheet persisted in DB (entry_type='stats_cache')."""
    n = Note.query.filter_by(
        user_id=user_id, entry_type='stats_cache', is_deleted=False
    ).first()
    if n and n.body:
        try:
            return json.loads(n.body)
        except Exception:
            pass
    return None


def _ensure_skill_habits(user_id, skills):
    """Auto-create a habit for any skill that has no matching habit yet."""
    from distro.svg.models.habit import Habit
    if not skills:
        return
    existing = [h.name.lower() for h in Habit.query.filter_by(user_id=user_id, is_active=True).all()]
    added = False
    for s in skills:
        skill_name = (s.get('name') or '').strip()
        if not skill_name:
            continue
        if any(skill_name.lower() in h or h in skill_name.lower() for h in existing):
            continue
        db.session.add(Habit(user_id=user_id, name=skill_name, track_type='manual'))
        existing.append(skill_name.lower())
        added = True
    if added:
        db.session.commit()


def _save_cached_sheet(user_id, sheet):
    """Persist stats sheet to DB so it survives server restarts."""
    n = Note.query.filter_by(
        user_id=user_id, entry_type='stats_cache', is_deleted=False
    ).first()
    if not n:
        n = Note(user_id=user_id, entry_type='stats_cache',
                 is_deleted=False, is_finished=False)
        db.session.add(n)
    n.title = 'stats_cache'
    n.body  = json.dumps(sheet)
    # manually bump updated_at so midnight check works
    n.updated_at = datetime.utcnow()
    db.session.commit()


def _calc_streak(user_id):
    one_year_ago = datetime.utcnow() - timedelta(days=365)
    entries = Note.query.filter(
        Note.user_id == user_id,
        Note.is_deleted == False,
        Note.entry_type.in_(['note', 'goal']),
        Note.updated_at >= one_year_ago
    ).with_entities(Note.updated_at, Note.created_at).all()

    active_dates = set()
    for e in entries:
        for dt in (e.updated_at, e.created_at):
            if dt:
                active_dates.add(dt.date())

    today = datetime.utcnow().date()
    check = today if today in active_dates else today - timedelta(days=1)
    streak = 0
    for i in range(365):
        day = check - timedelta(days=i)
        if day in active_dates:
            streak += 1
        else:
            break
    return streak


def _count_media(user_id):
    user_dir = os.path.join(_UPLOAD_LOCAL_DIR, f'user_{user_id}')
    if not os.path.isdir(user_dir):
        return 0
    try:
        return len([f for f in os.listdir(user_dir)
                    if os.path.isfile(os.path.join(user_dir, f))])
    except OSError:
        return 0


def _generate_character_sheet(user_id, user_context, notes_count, streak):
    from .chat_logger import read_user_log

    # ALL finished goals (not just this week) — these determine class and skills
    all_finished = Note.query.filter_by(
        user_id=user_id, entry_type='goal', is_deleted=False, is_finished=True
    ).order_by(Note.updated_at.desc()).limit(30).all()
    finished_str = ', '.join(g.title for g in all_finished) or 'none'

    # Work/achievements (with optional proof URLs for extra evidence)
    all_work = Note.query.filter_by(
        user_id=user_id, entry_type='achievement', is_deleted=False
    ).order_by(Note.created_at.desc()).limit(20).all()
    work_items = []
    for w in all_work:
        desc, proof, vs, vlink = _parse_ach_body(w.body)
        entry = w.title
        if desc:
            entry += f' ({desc})'
        if vs == 'link':
            entry += f' [VERIFIED via link: {vlink}]'
        elif vs in ('media', 'pending'):
            entry += ' [VERIFIED: media/screenshot uploaded as evidence]'
        elif proof:
            entry += f' [proof: {proof}]'
        work_items.append(entry)
    work_str = ', '.join(work_items) or 'none'

    goals_str = ', '.join(user_context['active_goals'][:10]) or 'none'
    notes_str = ', '.join(n['title'] for n in user_context['recent_notes'][:10]) or 'none'

    # Active habits that look like skill practice (not lifestyle/routine)
    _LIFESTYLE_KWS = ('sleep', 'water', 'wake', 'woke', 'bed', 'morning', 'routine',
                      'meditat', 'posture', 'journal', 'phone', 'drink', 'breathe',
                      'shower', 'step count', 'stretch', 'vitamins', 'supplements')
    skill_habits = [
        h['name'] for h in (user_context.get('habits') or [])
        if not any(kw in h['name'].lower() for kw in _LIFESTYLE_KWS)
    ]
    habit_skills_str = ', '.join(skill_habits[:15]) or 'none'

    log       = read_user_log(user_id) or ''
    exchanges = _parse_chat_log(log) if log else []
    history_lines = [
        f"[{ex['date']}] You: {ex['user'][:80]} | BlinkBot: {ex['bot'][:80]}"
        for ex in exchanges
    ]
    if len(history_lines) > 40:
        history_lines = history_lines[:10] + ['...'] + history_lines[-30:]
    chat_summary = '\n'.join(history_lines) if history_lines else 'No chat history yet.'

    prompt = (
        "Generate a character sheet for this person. Follow the rules exactly.\n\n"
        f"Dream: {user_context['dream'] or 'not set'}\n"
        f"Finished Goals: {finished_str}\n"
        f"Work / Shipped Projects (strongest evidence): {work_str}\n"
        f"Active Goals (aspirations only, do NOT use for ranking): {goals_str}\n"
        f"Active Skill Habits (ongoing practice — E-rank evidence): {habit_skills_str}\n"
        f"Notes Written: {notes_str}\n"
        f"Member Since: {user_context['member_since']}\n"
        f"Total Notes: {notes_count}, Streak: {streak} days\n\n"
        f"Conversation History:\n{chat_summary}\n\n"
        "STRICT RULES:\n"
        "1. CLASS is determined ONLY by Work/shipped projects + finished goals + top skills. "
        "   Active/planned goals do NOT count. No real output = class is 'Blank Slate'. "
        "   Use real-world role names (e.g. 'Runner', 'Writer', 'Developer'), NOT game titles.\n"
        "2. PERSONALITY is inferred from chat patterns, written goals, notes, behavior — "
        "   who they seem to be, what drives them. Short archetype name + one sentence.\n"
        "3. SKILLS come from: (a) Achievements/shipped projects — strongest signal; "
        "   (b) Finished goals — strong signal; "
        "   (c) Active Skill Habits — weakest signal, gives rank E only (unverified). "
        "   A habit like 'Run 5km', 'Practice guitar', 'Study Japanese' = E-rank skill evidence. "
        "   Never infer skills from active goals (goals are aspirations, habits are practice). "
        "   Return only skills with any evidence — 0 to 5 max. "
        "   Use plain words: 'Cooking' not 'Culinary Arts', 'Running' not 'Physical Fitness'. "
        "   LIFESTYLE / HABIT FILTER — CRITICAL: Completely ignore any entry that is a daily habit, "
        "   routine, or lifestyle behaviour — examples: 'woke up early', 'slept 8 hours', 'drank water', "
        "   'went to bed on time', 'morning routine', 'walked to work', 'meditated', 'no phone before bed'. "
        "   These are not skills and have no competitive benchmark — do NOT generate a skill row for them. "
        "   A bare 'Ran Xkm' with no time, pace, or Strava proof is also lifestyle — treat it as unverified Running at rank E.\n"
        "   SOFTWARE/TECH SKILLS — TWO-PHASE RULE:\n"
        "   Phase 1 (UNVERIFIED): If a software achievement has NO '[VERIFIED...]' tag, you CANNOT know "
        "   what was actually built, the tech stack, or the quality. Use skill name 'Software Development' "
        "   as a placeholder and rank it E. Do NOT guess B+ from the project name alone — "
        "   'Veyra SaaS' or any project name tells you nothing about frontend/backend/full-stack split, "
        "   code quality, or deployment status without proof. Note MUST ask for a GitHub link or "
        "   live URL so the next scan can determine the specific type and real rank.\n"
        "   Phase 2 (VERIFIED): Once '[VERIFIED via link: ...]' or '[VERIFIED: media...]' exists, "
        "   infer the specific type from the evidence — both UI and API/server code = 'Full-Stack Development'; "
        "   purely client-side = 'Frontend Development'; API/server/DB only = 'Backend Development'; "
        "   mobile app = 'iOS/Android Development'; ML model or pipeline = 'Machine Learning'; etc. "
        "   Do NOT use 'Software Development' once verified — be specific.\n"
        "   OVERRIDE RULE — VERIFIED EVIDENCE: Any achievement tagged '[VERIFIED: media/screenshot uploaded as evidence]' "
        "   or '[VERIFIED via link: ...]' means the user HAS ALREADY submitted proof. "
        "   You MUST set 'verified': true for the skill matching that achievement. This is unconditional — do not override it. "
        "   If the evidence references running (Strava/NRC screenshot, run data), rank it as Running. "
        "   If the evidence is a GitHub repo/link, rank it as the relevant code skill. Etc.\n"
        "   VERIFIED field: set 'verified': true ONLY if there is a '[VERIFIED...]' tag OR a concrete, "
        "   independently checkable metric (a finishing time, a Strava export, a public GitHub link). "
        "   A bare achievement title with no tag and no metric = verified: false. "
        "   Unverified skills will show '?' rank to the user until they submit evidence.\n"
        "   Leave the 'note' field empty — notes are handled automatically by the app.\n"
        "4. RANKING — CRITICAL RULE: rank ONLY relative to people who actively practise that skill. "
        "   Never compare against the general public — most people never run, code, cook, etc. "
        "   Use real-world census/stats data for each field to calibrate benchmarks. "
        "   'Among the people who do this, where does this person stand?'\n"
        "   S+ = Beyond any known record in the field\n"
        "   S  = Top 0.001% of active practitioners (absolute world-class)\n"
        "   S- = Top 0.01–0.1% of active practitioners (national/international competitor level)\n"
        "   A+ = Top 1% of active practitioners\n"
        "   A  = Top 1–5% of active practitioners\n"
        "   A- = Top 5–10% of active practitioners\n"
        "   B+ = Top 10–20% of active practitioners\n"
        "   B  = Top 20–30% of active practitioners\n"
        "   B- = Top 30–40% of active practitioners\n"
        "   C+ = Top 40–50% of active practitioners\n"
        "   C  = Top 50–60% of active practitioners (median)\n"
        "   C- = Top 60–70% of active practitioners\n"
        "   D+ = Top 70–80% of active practitioners\n"
        "   D  = Top 80–90% of active practitioners\n"
        "   D- = Top 90–99% of active practitioners (bottom tier, but still practising)\n"
        "   E+ = Active beginner — regular practice, several months in, no metrics yet\n"
        "   E  = Beginner — started recently, a handful of sessions\n"
        "   E- = Very first steps — one or two tries, just discovered the skill\n"
        "   F  = General public — has not started this skill at all\n"
        "   CALIBRATION EXAMPLES:\n"
        "   Running (global ~800M recreational runners): average 5K ~27 min. Sub-17 = S-. Sub-20 = A+. Sub-24 = B. Sub-30 = C. Just started = E.\n"
        "   Software Dev (~27M professional devs worldwide — ONLY applies to VERIFIED achievements): "
        "   verified live deployment + clean code = B+. Verified active open-source contributor = A. "
        "   Verified side project, no live product = B-. Unverified claim of any project = E (placeholder). "
        "   Never rank above E without a '[VERIFIED...]' tag or independently checkable proof.\n"
        "   Cooking (~1B regular home cooks): makes complex multi-course meals = A-. Reliable weekday cooking = C+. Just started = E.\n"
        "   If you cannot determine rank from available data, use E and add a note asking "
        "   for the data needed.\n"
        "   DO NOT give high ranks because a goal sounds ambitious. Only evidence counts.\n"
        "5. CONTEXT — only for VERIFIED skills (verified: true). "
        "   One line anchoring the rank in real-world terms — answers 'compared to what?'. "
        "   For measurable skills (running, lifting, chess, swimming): use the actual metric from the evidence. "
        "   For skills without hard global data (cooking, writing, creativity): describe the landscape honestly, end with '(estimated)'. "
        "   Never invent a percentage or metric that isn't in the evidence. "
        "   Keep it under 15 words. No rank letter — the badge already shows that. "
        "   For unverified skills, set context to empty string.\n"
        "6. Simple English throughout. Common words only.\n\n"
        "Output ONLY valid JSON:\n"
        '{"class_official":"role based on achievements (Blank Slate if none)",'
        '"class_playful":"same role with flair",'
        '"personality":"2-4 word archetype",'
        '"personality_desc":"One sentence about their mindset.",'
        '"bio":"One sentence. Who they actually are right now.",'
        '"skills":['
        '{"name":"plain skill name","rank":"E","verified":false,"context":"one-line real-world anchor for the rank","note":"optional — what to add to unlock rank"}'
        ']}'
    )

    def _parse_json(raw):
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return None

    _TECH_KEYWORDS = ('development', 'engineering', 'programming', 'coding', 'software',
                      'frontend', 'backend', 'fullstack', 'full-stack', 'devops',
                      'machine learning', 'ml', 'ios', 'android', 'web dev')
    _RUN_KEYWORDS   = ('running', 'run', 'marathon', '5k', '10k', 'sprint', 'jogging')
    _LIFT_KEYWORDS  = ('strength', 'powerlifting', 'weightlifting', 'lifting', 'squat', 'bench', 'deadlift', 'gym')
    _COOK_KEYWORDS  = ('cooking', 'culinary', 'baking', 'chef', 'cuisine')

    _NOTES = {
        'tech':     'Verify with a GitHub link or live URL — it reveals your stack and unlocks a real rank.',
        'running':  'Add a result with a time or pace and verify with a Strava screenshot.',
        'lifting':  'Log a max lift (squat / bench / deadlift in kg) and verify with a video.',
        'cooking':  'Add a dish you cook regularly and verify with a photo or video.',
        'default':  'Add specific results or proof in Achievements to unlock a real rank.',
    }

    def _enforce_rules(sheet):
        """Post-process: unverified = rank E, no context, standardised note."""
        if not sheet or 'skills' not in sheet:
            return sheet
        for s in sheet['skills']:
            if s.get('verified') is False:
                s['rank'] = 'E'
                s['context'] = ''
                name_lower = (s.get('name') or '').lower()
                if any(kw in name_lower for kw in _TECH_KEYWORDS):
                    s['name'] = 'Software Development'
                    s['note'] = _NOTES['tech']
                elif any(kw in name_lower for kw in _RUN_KEYWORDS):
                    s['note'] = _NOTES['running']
                elif any(kw in name_lower for kw in _LIFT_KEYWORDS):
                    s['note'] = _NOTES['lifting']
                elif any(kw in name_lower for kw in _COOK_KEYWORDS):
                    s['note'] = _NOTES['cooking']
                else:
                    s['note'] = _NOTES['default']
        return sheet

    # Primary: BuddyBot on-server (needs fast hardware)
    if _LOCAL_INFERENCE and _LLAMA_OK and os.path.exists(_BUDDY_PATH):
        try:
            model    = _get_buddybot()
            messages = [
                {'role': 'system', 'content': (
                    'You generate RPG character sheets as valid JSON. '
                    'Output only the JSON object, nothing else.'
                )},
                {'role': 'user', 'content': prompt}
            ]
            out = model.create_chat_completion(
                messages=messages, max_tokens=400, temperature=0.8,
                stop=['<|im_end|>', '</s>']
            )
            result = _enforce_rules(_parse_json(out['choices'][0]['message']['content'].strip()))
            if result:
                return result
        except Exception as e:
            current_app.logger.error(f'BuddyBot character sheet error: {e}')

    # Fallback: Groq
    import requests as req
    api_key = os.environ.get('PUG_GROQ_API_KEY', '')
    if not api_key:
        return None
    try:
        r = req.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model':       'llama-3.3-70b-versatile',
                'messages':    [{'role': 'user', 'content': prompt}],
                'max_tokens':  400,
                'temperature': 0.8,
            },
            timeout=20
        )
        if r.ok:
            return _enforce_rules(_parse_json(r.json()['choices'][0]['message']['content'].strip()))
    except Exception as e:
        current_app.logger.error(f'Groq character sheet error: {e}')
    return None


pug_bp = Blueprint(
    'pug',
    __name__,
    static_folder='../static',
    static_url_path='/pug_style',
    template_folder='../templates',
)

MINIO_ENDPOINT   = os.environ.get('MINIO_ENDPOINT',   'localhost:9000')
MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET     = os.environ.get('MINIO_BUCKET',     'veyra-media')
MINIO_SECURE     = os.environ.get('MINIO_SECURE',     'false').lower() == 'true'
_UPLOAD_LOCAL_DIR = os.environ.get(
    'UPLOAD_DIR',
    '/data/veyra_media' if os.path.isdir('/data') else '/tmp/veyra_media'
)

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=MINIO_SECURE
)

ALLOWED_IMAGE  = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
ALLOWED_VIDEO  = {'mp4', 'webm'}
ALLOWED_AUDIO  = {'mp3', 'wav', 'ogg', 'm4a', 'flac'}
ALLOWED_SHARED = ALLOWED_IMAGE | ALLOWED_VIDEO | ALLOWED_AUDIO

# Magic-byte signatures — checked before any processing to reject zip bombs and spoofed extensions
_MAGIC = {
    'jpg':  (b'\xff\xd8\xff',),
    'jpeg': (b'\xff\xd8\xff',),
    'png':  (b'\x89PNG',),
    'gif':  (b'GIF87a', b'GIF89a'),
    'webp': (b'RIFF',),          # RIFF....WEBP — first 4 bytes are enough
    'mp4':  (b'\x00\x00\x00',),  # ftyp box — first 3 null bytes present in all valid mp4
    'webm': (b'\x1a\x45\xdf\xa3',),
    'mp3':  (b'\xff\xfb', b'\xff\xf3', b'\xff\xf2', b'ID3'),
    'wav':  (b'RIFF',),
    'ogg':  (b'OggS',),
    'm4a':  (b'\x00\x00\x00',),
    'flac': (b'fLaC',),
}


def _valid_magic(data: bytes, ext: str) -> bool:
    sigs = _MAGIC.get(ext)
    if not sigs:
        return True
    return any(data[:len(s)] == s for s in sigs)


def ensure_bucket():
    try:
        if not minio_client.bucket_exists(MINIO_BUCKET):
            # R2 buckets must be created in the Cloudflare dashboard — skip auto-create
            if 'r2.cloudflarestorage.com' not in MINIO_ENDPOINT:
                minio_client.make_bucket(MINIO_BUCKET)
    except S3Error as e:
        current_app.logger.warning(f'Storage bucket check failed: {e}')


def login_required_page():
    if not session.get('user_id'):
        return redirect(url_for('svg.login'))
    if session.get('distro') != 'ThePug':
        return redirect(url_for('svg.login'))
    return None


def login_required_api():
    if not session.get('user_id'):
        return jsonify({'error': 'Not authenticated'}), 401
    if session.get('distro') != 'ThePug':
        return jsonify({'error': 'Forbidden'}), 403
    return None


@pug_bp.route('/pug/home')
def home():
    guard = login_required_page()
    if guard:
        return guard
    return render_template('pug/home.html', username=session.get('username', 'User'))


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
    data = request.get_json(silent=True) or {}
    note_id      = data.get('id')
    title        = data.get('title', '')
    body         = data.get('body', '')
    if len(title) > 500:
        return jsonify({'status': 'error', 'message': 'Title too long'}), 400
    if len(body) > 100_000:
        return jsonify({'status': 'error', 'message': 'Body too long'}), 400
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
    data  = request.get_json(silent=True) or {}
    title = data.get('title', '').strip()
    if not title:
        return jsonify({'status': 'error'}), 400
    if len(title) > 500:
        return jsonify({'status': 'error', 'message': 'Title too long'}), 400
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


@pug_bp.route('/pug/api/goals/cancelled', methods=['GET'])
def get_cancelled_goals():
    err = login_required_api()
    if err: return err
    goals = Note.query.filter_by(
        user_id=session['user_id'], entry_type='goal',
        is_deleted=True, is_finished=False
    ).order_by(Note.updated_at.desc()).limit(20).all()
    return jsonify([g.to_dict() for g in goals])


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
        dropped = Note.query.filter(
            Note.user_id == session['user_id'], Note.entry_type == 'goal',
            Note.is_deleted == True, Note.is_finished == False,
            Note.updated_at >= start, Note.updated_at <= end
        ).count()
        result.append({'day': day.strftime('%a'), 'added': added, 'finished': finished, 'dropped': dropped})
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
@limiter.limit("30 per minute")
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
    file_data   = file.read()
    if len(file_data) > 50 * 1024 * 1024:
        return jsonify({'error': 'File too large (max 50 MB)'}), 400
    if not _valid_magic(file_data, ext):
        return jsonify({'error': 'File content does not match extension'}), 400
    try:
        ensure_bucket()
        minio_client.put_object(
            MINIO_BUCKET, object_name, io.BytesIO(file_data),
            length=len(file_data), content_type=content_type
        )
    except Exception as e:
        current_app.logger.warning(f"MinIO unavailable, falling back to local storage: {e}")
        local_path = os.path.join(_UPLOAD_LOCAL_DIR, object_name)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, 'wb') as f:
            f.write(file_data)
    return jsonify({'url': url_for('pug.serve_media', object_name=object_name),
                    'type': 'image' if ext in ALLOWED_IMAGE else 'video'})


@pug_bp.route('/pug/api/media/<path:object_name>')
def serve_media(object_name):
    err = login_required_api()
    if err: return err
    if ('..' in object_name or '\x00' in object_name
            or object_name != object_name.replace('\\', '')):
        return jsonify({'error': 'Forbidden'}), 403
    if not object_name.startswith(f"user_{session['user_id']}/"):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        response = minio_client.get_object(MINIO_BUCKET, object_name)
        return Response(
            response.stream(32 * 1024),
            content_type=response.headers.get('content-type', 'application/octet-stream')
        )
    except Exception:
        pass
    import mimetypes
    local_path = os.path.join(_UPLOAD_LOCAL_DIR, object_name)
    if os.path.exists(local_path):
        ct = mimetypes.guess_type(local_path)[0] or 'application/octet-stream'
        with open(local_path, 'rb') as f:
            return Response(f.read(), content_type=ct)
    return jsonify({'error': 'File not found'}), 404


@pug_bp.route('/pug/api/upload_shared', methods=['POST'])
@limiter.limit("30 per minute")
def upload_shared():
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
        ftype = 'image'
    elif ext in ALLOWED_VIDEO:
        content_type = f'video/{ext}'
        ftype = 'video'
    elif ext in ALLOWED_AUDIO:
        content_type = f'audio/{ext}'
        ftype = 'audio'
    else:
        return jsonify({'error': f'.{ext} not allowed'}), 400
    file_data = file.read()
    if len(file_data) > 50 * 1024 * 1024:
        return jsonify({'error': 'File too large (max 50 MB)'}), 400
    if not _valid_magic(file_data, ext):
        return jsonify({'error': 'File content does not match extension'}), 400
    object_name = f"shared/{uuid.uuid4().hex}.{ext}"
    try:
        ensure_bucket()
        minio_client.put_object(
            MINIO_BUCKET, object_name, io.BytesIO(file_data),
            length=len(file_data), content_type=content_type
        )
    except Exception as e:
        current_app.logger.warning(f"MinIO shared upload failed: {e}")
        local_path = os.path.join(_UPLOAD_LOCAL_DIR, object_name)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, 'wb') as fh:
            fh.write(file_data)
    return jsonify({
        'key':  object_name,
        'url':  url_for('pug.serve_media_shared', object_name=object_name),
        'type': ftype,
    })


@pug_bp.route('/pug/api/media/shared/<path:object_name>')
def serve_media_shared(object_name):
    err = login_required_api()
    if err: return err
    # Block path traversal and enforce shared/ prefix
    if (not object_name.startswith('shared/')
            or '..' in object_name
            or '\x00' in object_name
            or object_name != object_name.replace('\\', '')):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        response = minio_client.get_object(MINIO_BUCKET, object_name)
        return Response(
            response.stream(32 * 1024),
            content_type=response.headers.get('content-type', 'application/octet-stream')
        )
    except Exception:
        pass
    import mimetypes
    local_path = os.path.join(_UPLOAD_LOCAL_DIR, object_name)
    if os.path.exists(local_path):
        ct = mimetypes.guess_type(local_path)[0] or 'application/octet-stream'
        with open(local_path, 'rb') as f:
            return Response(f.read(), content_type=ct)
    return jsonify({'error': 'File not found'}), 404


@pug_bp.route('/pug/api/location', methods=['POST'])
def save_location():
    err = login_required_api()
    if err: return err
    data = request.get_json(force=True) or {}
    try:
        lat = float(data['lat'])
        lng = float(data['lng'])
    except (KeyError, ValueError, TypeError):
        return jsonify({'error': 'lat and lng required'}), 400
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({'error': 'coordinates out of range'}), 400
    existing = Note.query.filter_by(
        user_id=session['user_id'], entry_type='user_location', is_deleted=False
    ).first()
    if not existing:
        existing = Note(
            user_id=session['user_id'], entry_type='user_location',
            is_deleted=False, is_finished=False
        )
        existing.title = 'location'
        db.session.add(existing)
    existing.body = json.dumps({'lat': lat, 'lng': lng})
    existing.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/users/<int:uid>/profile')
def get_user_profile(uid):
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    u = User.query.get(uid)
    if not u or u.distro != 'ThePug':
        return jsonify({'error': 'Not found'}), 404
    n = Note.query.filter_by(user_id=uid, entry_type='stats_cache', is_deleted=False).first()
    sheet = None
    if n and n.body:
        try:
            sheet = json.loads(n.body)
        except Exception:
            pass
    rank, color = _net_rank_for_user(uid)
    return jsonify({
        'id':         uid,
        'username':   u.username,
        'rank':       rank,
        'rank_color': color,
        'sheet':      sheet,
    })


@pug_bp.route('/pug/api/ask', methods=['POST'])
@limiter.limit("30 per minute")
def ask():
    err = login_required_api()
    if err: return err
    data  = request.get_json(silent=True) or {}
    query = data.get('query', '').strip()
    if not query:
        return jsonify({'error': 'Empty query'}), 400
    if len(query) > 2000:
        return jsonify({'error': 'Query too long'}), 400
    import requests as req
    api_key = os.environ.get('PUG_GROQ_API_KEY', '')
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
@limiter.limit("20 per minute")
def blinkbot_chat():
    err = login_required_api()
    if err: return err
    return jsonify({'answer': 'BlinkBot is being rebuilt — coming soon.', 'source': 'offline'}), 200


@pug_bp.route('/pug/api/buddybot', methods=['POST'])
def buddybot_endpoint():
    err = login_required_api()
    if err: return err
    return jsonify({'answer': 'BuddyBot is coming soon.', 'source': 'offline'}), 200

    if not _LLAMA_OK or not _BUDDYBOT_ENABLED:
        return jsonify({'error': 'BuddyBot not available on this server'}), 503

    data           = request.get_json()
    context_packet = data.get('context_packet', '').strip()
    ctx_data       = data.get('user_context', {})

    if not context_packet:
        return jsonify({'error': 'No context packet'}), 400

    try:
        # Always use server-side session username — never trust client-supplied value
        user_context = {
            'username':           session.get('username', ''),
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


@pug_bp.route('/pug/api/desktop/chat', methods=['POST'])
def desktop_buddybot_chat():
    """Localhost-only endpoint for ArchPlay desktop shell scripts.
    No session auth — only accepts connections from 127.0.0.1.
    """
    if request.remote_addr != '127.0.0.1':
        return jsonify({'error': 'Forbidden'}), 403

    data           = request.get_json(silent=True) or {}
    message        = data.get('message', '').strip()
    memory_context = data.get('memory_context', '')
    mode           = data.get('mode', 'buddybot')

    if not message:
        return jsonify({'reply': ''}), 200

    # Build context packet from shell-supplied memory snippets + message
    packet = (
        f"relevant_memory:\n{memory_context}\n\n"
        f"question_core: {message}\n"
        f"task: answer_directly"
    ) if memory_context else (
        f"question_core: {message}\ntask: answer_directly"
    )

    # Minimal user context — no DB lookup, desktop-mode user
    user_context = {
        'username':           'pug',
        'member_since':       '',
        'dream':              None,
        'active_goals':       [],
        'finished_this_week': [],
        'recent_notes':       []
    }

    try:
        if _LOCAL_INFERENCE and _LLAMA_OK and os.path.exists(_BUDDY_PATH):
            reply = _call_buddybot(packet, user_context)
        else:
            reply = _call_groq_chat(message, [], user_context)
        return jsonify({'reply': reply})
    except Exception as e:
        current_app.logger.error(f"Desktop chat error: {e}")
        return jsonify({'reply': 'BuddyBot unavailable right now.'}), 503


@pug_bp.route('/pug/api/stats', methods=['GET'])
@limiter.limit("10 per minute")
def get_stats_sheet():
    err = login_required_api()
    if err: return err

    user_id    = session['user_id']
    refresh    = request.args.get('refresh',    'false').lower() == 'true'
    cache_only = request.args.get('cache_only', 'false').lower() == 'true'

    notes_count = Note.query.filter_by(
        user_id=user_id, entry_type='note', is_deleted=False
    ).count()
    streak      = _calc_streak(user_id)
    media_count = _count_media(user_id)

    # DB-backed cache — survives server restarts
    db_sheet = _get_cached_sheet(user_id)

    if cache_only:
        # Page-load silent fetch: only return what's already stored, never generate
        sheet = db_sheet
    elif refresh:
        # Midnight forced refresh — always regenerate
        user_context = _assemble_user_context(user_id, session.get('username', ''))
        sheet = _generate_character_sheet(user_id, user_context, notes_count, streak)
        if sheet:
            _save_cached_sheet(user_id, sheet)
            _ensure_skill_habits(user_id, sheet.get('skills', []))
    elif db_sheet:
        # Cache exists — return it regardless of age; midnight refresh handles updates
        sheet = db_sheet
    else:
        # No cache at all (first use) — generate once
        user_context = _assemble_user_context(user_id, session.get('username', ''))
        sheet = _generate_character_sheet(user_id, user_context, notes_count, streak)
        if sheet:
            _save_cached_sheet(user_id, sheet)
            _ensure_skill_habits(user_id, sheet.get('skills', []))

    return jsonify({
        'notes_count': notes_count,
        'streak':      streak,
        'media_count': media_count,
        'sheet':       sheet,
    })


@pug_bp.route('/pug/api/profile/username', methods=['PATCH'])
def update_username():
    from shared.auth.user import User
    err = login_required_api()
    if err: return err
    data     = request.get_json(force=True) or {}
    new_name = (data.get('username') or '').strip()
    if not new_name or len(new_name) < 2:
        return jsonify({'error': 'Username too short'}), 400
    if User.query.filter(User.username == new_name, User.id != session['user_id']).first():
        return jsonify({'error': 'Username taken'}), 409
    user = User.query.get(session['user_id'])
    user.username = new_name
    session['username'] = new_name
    db.session.commit()
    return jsonify({'ok': True, 'username': new_name})


@pug_bp.route('/pug/api/profile/password', methods=['PATCH'])
def update_password():
    from shared.auth.user import User
    from werkzeug.security import check_password_hash, generate_password_hash
    err = login_required_api()
    if err: return err
    data         = request.get_json(force=True) or {}
    current      = data.get('current', '')
    new_password = data.get('new', '')
    if not new_password or len(new_password) < 8:
        return jsonify({'error': 'Password too short (min 8 chars)'}), 400
    user = User.query.get(session['user_id'])
    if not check_password_hash(user.password_hash, current):
        return jsonify({'error': 'Current password is wrong'}), 403
    user.password_hash = generate_password_hash(new_password)
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/profile/delete', methods=['DELETE'])
def delete_account():
    from shared.auth.user import User
    from werkzeug.security import check_password_hash
    err = login_required_api()
    if err: return err
    data     = request.get_json(force=True) or {}
    password = data.get('password', '')
    user     = User.query.get(session['user_id'])
    if not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Wrong password'}), 403
    Note.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    session.clear()
    return jsonify({'ok': True})


def _parse_ach_body(raw):
    """Return (desc, proof_url, verified_status, verify_link). Handles plain text and JSON."""
    if not raw:
        return '', '', None, ''
    if raw.startswith('{'):
        try:
            d = json.loads(raw)
            return d.get('d', ''), d.get('p', ''), d.get('vs'), d.get('vl', '')
        except Exception:
            pass
    return raw, '', None, ''


_RANK_COLORS = {
    'S+':'#ffd700','S':'#ffb700','S-':'#ffa500',
    'A+':'#ff7c4d','A':'#ff8c42','A-':'#e8854a',
    'B+':'#5a8fc8','B':'#4a7aaa','B-':'#4070a0',
    'C+':'#8ac888','C':'#78b878','C-':'#68a068',
    'D+':'#a0a0a0','D':'#888888','D-':'#707070',
    'E':'#c06030','F':'#803010',
}

def _net_rank_for_user(uid):
    """Return (rank_str, color) from that user's stats cache, or (None, None)."""
    n = Note.query.filter_by(user_id=uid, entry_type='stats_cache', is_deleted=False).first()
    if not n or not n.body:
        return None, None
    try:
        sheet = json.loads(n.body)
        skills = sheet.get('skills', [])
        order = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E','F']
        for r in order:
            if any(s.get('rank','').upper() == r and s.get('verified', True) for s in skills):
                return r, _RANK_COLORS.get(r, '#888')
    except Exception:
        pass
    return None, None


def _haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


def _user_location(uid):
    """Return (lat, lng) from user_location note, or (None, None)."""
    n = Note.query.filter_by(user_id=uid, entry_type='user_location', is_deleted=False).first()
    if not n or not n.body:
        return None, None
    try:
        d = json.loads(n.body)
        return float(d['lat']), float(d['lng'])
    except Exception:
        return None, None


def _user_has_skill(uid, skill_name):
    """Return True if the user has a verified skill whose name contains skill_name (case-insensitive)."""
    n = Note.query.filter_by(user_id=uid, entry_type='stats_cache', is_deleted=False).first()
    if not n or not n.body:
        return False
    try:
        sheet = json.loads(n.body)
        return any(
            s.get('verified', False) and skill_name in (s.get('name') or '').lower()
            for s in sheet.get('skills', [])
        )
    except Exception:
        return False


@pug_bp.route('/pug/api/community', methods=['GET'])
def get_community_feed():
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    me = session['user_id']

    # Optional location filter
    try:
        my_lat = float(request.args['lat'])
        my_lng = float(request.args['lng'])
        use_location = True
    except (KeyError, ValueError):
        use_location = False

    skill_filter = (request.args.get('skill') or '').strip().lower()

    posts = Note.query.filter_by(
        entry_type='community_post', is_deleted=False, mood='ThePug'
    ).order_by(Note.created_at.desc()).limit(200).all()

    def _build_row(p, u):
        rank, color = _net_rank_for_user(p.user_id)
        body = p.body or ''
        text, media_key = body, None
        if body.startswith('{'):
            try:
                bd = json.loads(body)
                text      = bd.get('t', '')
                media_key = bd.get('m')
            except Exception:
                pass
        media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
        return {
            'id':         p.id,
            'text':       text,
            'media_key':  media_key,
            'media_url':  media_url,
            'username':   u.username,
            'user_id':    p.user_id,
            'distro':     p.mood or 'ThePug',
            'rank':       rank,
            'rank_color': color,
            'is_mine':    p.user_id == me,
            'created_at': p.created_at.isoformat() if p.created_at else None,
        }

    if use_location:
        for radius_km in (50, 100, 250, None):
            result = []
            for p in posts:
                u = User.query.get(p.user_id)
                if not u: continue
                if radius_km is not None:
                    plat, plng = _user_location(p.user_id)
                    if plat is None or _haversine_km(my_lat, my_lng, plat, plng) > radius_km:
                        continue
                if skill_filter and not _user_has_skill(p.user_id, skill_filter):
                    continue
                result.append(_build_row(p, u))
            if len(result) >= 5 or radius_km is None:
                return jsonify({'posts': result, 'radius_km': radius_km})
        return jsonify({'posts': [], 'radius_km': None})

    result = []
    for p in posts:
        u = User.query.get(p.user_id)
        if not u: continue
        if skill_filter and not _user_has_skill(p.user_id, skill_filter):
            continue
        result.append(_build_row(p, u))
    return jsonify({'posts': result, 'radius_km': None})


@pug_bp.route('/pug/api/community', methods=['POST'])
def create_community_post():
    err = login_required_api()
    if err: return err
    data      = request.get_json(force=True) or {}
    text      = (data.get('text') or '').strip()
    media_key = (data.get('media_key') or '').strip()
    if not text and not media_key:
        return jsonify({'error': 'Empty post'}), 400
    if len(text) > 500:
        return jsonify({'error': 'Too long (max 500 chars)'}), 400
    if media_key and not media_key.startswith('shared/'):
        return jsonify({'error': 'Invalid media key'}), 400
    body_val = json.dumps({'t': text, 'm': media_key}) if media_key else text
    p = Note(
        user_id    = session['user_id'],
        entry_type = 'community_post',
        is_deleted = False,
        is_finished= False,
    )
    p.body = body_val
    p.mood = session.get('distro', 'ThePug')
    db.session.add(p)
    db.session.commit()
    return jsonify({'id': p.id, 'ok': True}), 201


@pug_bp.route('/pug/api/community/<int:pid>', methods=['DELETE'])
def delete_community_post(pid):
    err = login_required_api()
    if err: return err
    p = Note.query.filter_by(id=pid, user_id=session['user_id'], entry_type='community_post').first()
    if not p:
        return jsonify({'error': 'Not found'}), 404
    p.is_deleted = True
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/users/search')
def search_users():
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    from sqlalchemy import or_
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify([])
    me = session['user_id']
    users = User.query.filter(
        User.username.ilike(f'%{q}%'),
        User.id != me,
        User.distro == 'ThePug'
    ).limit(10).all()
    return jsonify([{'id': u.id, 'username': u.username} for u in users])


@pug_bp.route('/pug/api/dms', methods=['GET'])
def list_dms():
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    me = session['user_id']
    # mood stores receiver_id; get all messages I sent or received
    sent     = Note.query.filter_by(user_id=me,   entry_type='dm', is_deleted=False).all()
    received = Note.query.filter_by(mood=str(me),  entry_type='dm', is_deleted=False).all()
    all_msgs = sent + received
    all_msgs.sort(key=lambda m: m.created_at or datetime.min, reverse=True)
    seen = {}
    for m in all_msgs:
        other_id = int(m.mood) if m.user_id == me else m.user_id
        if other_id not in seen:
            seen[other_id] = m
    result = []
    for other_id, last_msg in seen.items():
        u = User.query.get(other_id)
        if not u: continue
        unread_count = Note.query.filter_by(
            user_id=other_id, mood=str(me), entry_type='dm',
            is_deleted=False, is_finished=False
        ).count()
        raw_body = last_msg.body or ''
        if raw_body.startswith('{'):
            try:
                bd = json.loads(raw_body)
                raw_body = bd.get('t', '') or ('[media]' if bd.get('m') else '')
            except Exception:
                pass
        result.append({
            'other_id':  other_id,
            'username':  u.username,
            'last_msg':  raw_body[:60],
            'last_time': last_msg.created_at.isoformat() if last_msg.created_at else None,
            'unread':    unread_count > 0,
        })
    return jsonify(result)


@pug_bp.route('/pug/api/dms/<int:other_id>', methods=['GET'])
def get_dm_thread(other_id):
    err = login_required_api()
    if err: return err
    me = session['user_id']
    sent     = Note.query.filter_by(user_id=me,       mood=str(other_id), entry_type='dm', is_deleted=False).all()
    received = Note.query.filter_by(user_id=other_id, mood=str(me),       entry_type='dm', is_deleted=False).all()
    msgs = sorted(sent + received, key=lambda m: m.created_at or datetime.min)
    rows = []
    for m in msgs:
        raw = m.body or ''
        text, media_key = raw, None
        if raw.startswith('{'):
            try:
                bd = json.loads(raw)
                text      = bd.get('t', '')
                media_key = bd.get('m')
            except Exception:
                pass
        media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
        rows.append({
            'id':         m.id,
            'body':       text,
            'media_key':  media_key,
            'media_url':  media_url,
            'is_mine':    m.user_id == me,
            'created_at': m.created_at.isoformat() if m.created_at else None,
        })
    return jsonify(rows)


@pug_bp.route('/pug/api/dms/<int:other_id>', methods=['POST'])
def send_dm(other_id):
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    me = session['user_id']
    if other_id == me:
        return jsonify({'error': 'Cannot DM yourself'}), 400
    recipient = User.query.filter_by(id=other_id, distro='ThePug').first()
    if not recipient:
        return jsonify({'error': 'User not found'}), 404
    data      = request.get_json(force=True) or {}
    body      = (data.get('body') or '').strip()
    media_key = (data.get('media_key') or '').strip()
    if not body and not media_key:
        return jsonify({'error': 'Empty message'}), 400
    if media_key and not media_key.startswith('shared/'):
        return jsonify({'error': 'Invalid media key'}), 400
    if len(body) > 2000:
        return jsonify({'error': 'Message too long'}), 400
    body_val  = json.dumps({'t': body, 'm': media_key}) if media_key else body
    media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
    m = Note(
        user_id    = me,
        entry_type = 'dm',
        is_deleted = False,
        is_finished= False,
    )
    m.body = body_val
    m.mood = str(other_id)
    db.session.add(m)
    db.session.commit()
    return jsonify({
        'id':         m.id,
        'body':       body,
        'media_key':  media_key or None,
        'media_url':  media_url,
        'is_mine':    True,
        'created_at': m.created_at.isoformat() if m.created_at else None,
    }), 201


@pug_bp.route('/pug/api/dms/<int:other_id>/read', methods=['PATCH'])
def mark_dms_read(other_id):
    err = login_required_api()
    if err: return err
    me = session['user_id']
    Note.query.filter_by(
        user_id=other_id, mood=str(me), entry_type='dm',
        is_deleted=False, is_finished=False
    ).update({'is_finished': True})
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/achievements', methods=['GET'])
def get_achievements():
    err = login_required_api()
    if err: return err
    items = Note.query.filter_by(
        user_id=session['user_id'], entry_type='achievement', is_deleted=False
    ).order_by(Note.created_at.desc()).all()
    result = []
    for n in items:
        desc, proof, verified, vlink = _parse_ach_body(n.body)
        result.append({'id': n.id, 'title': n.title, 'desc': desc, 'proof': proof,
                       'verified': verified, 'vlink': vlink,
                       'created_at': n.created_at.isoformat() if n.created_at else None})
    return jsonify(result)


@pug_bp.route('/pug/api/achievements', methods=['POST'])
def add_achievement():
    err = login_required_api()
    if err: return err
    data  = request.get_json(force=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Title required'}), 400
    desc  = (data.get('description') or '').strip()
    proof = (data.get('proof') or '').strip()
    body_val = json.dumps({'d': desc, 'p': proof}) if (desc or proof) else ''
    n = Note(
        user_id    = session['user_id'],
        entry_type = 'achievement',
        is_deleted = False,
        is_finished= False,
    )
    n.title = title
    n.body  = body_val
    db.session.add(n)
    db.session.commit()
    return jsonify({'id': n.id, 'title': n.title, 'desc': desc, 'proof': proof}), 201


@pug_bp.route('/pug/api/achievements/<int:aid>', methods=['DELETE'])
def delete_achievement(aid):
    err = login_required_api()
    if err: return err
    n = Note.query.filter_by(id=aid, user_id=session['user_id'], entry_type='achievement').first()
    if not n:
        return jsonify({'error': 'Not found'}), 404
    n.is_deleted = True
    db.session.commit()
    return jsonify({'ok': True})


ALLOWED_VERIFY_MEDIA = {'mp3', 'wav', 'ogg', 'flac', 'mp4', 'webm', 'mov', 'avi',
                        'jpg', 'jpeg', 'png', 'gif', 'webp'}

@pug_bp.route('/pug/api/achievements/<int:aid>/verify', methods=['PATCH'])
def verify_achievement(aid):
    err = login_required_api()
    if err: return err
    n = Note.query.filter_by(id=aid, user_id=session['user_id'], entry_type='achievement').first()
    if not n:
        return jsonify({'error': 'Not found'}), 404

    existing = {}
    if n.body and n.body.startswith('{'):
        try:
            existing = json.loads(n.body)
        except Exception:
            pass

    link = ''
    if request.is_json:
        data = request.get_json(force=True) or {}
        link = (data.get('link') or '').strip()
    elif request.form:
        link = (request.form.get('link') or '').strip()

    if link:
        # Only allow http/https URLs to block javascript: and data: URIs
        if not re.match(r'^https?://', link):
            return jsonify({'error': 'Link must be an http/https URL'}), 400
        if len(link) > 2048:
            return jsonify({'error': 'Link too long'}), 400
        existing['vl'] = link
        existing['vs'] = 'link'

    file = request.files.get('media') if request.files else None
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
        if ext not in ALLOWED_VERIFY_MEDIA:
            return jsonify({'error': f'.{ext} not supported'}), 400
        file_data = file.read()
        if len(file_data) > 50 * 1024 * 1024:
            return jsonify({'error': 'File too large (max 50 MB)'}), 400
        if not _valid_magic(file_data, ext):
            return jsonify({'error': 'File content does not match extension'}), 400
        if ext in {'mp3', 'wav', 'ogg', 'flac'}:
            ct = f'audio/{ext}'
        elif ext in {'mp4', 'webm', 'mov', 'avi'}:
            ct = f'video/{ext}'
        else:
            ct = f'image/{"jpeg" if ext == "jpg" else ext}'
        object_name = f"user_{session['user_id']}/verify_{uuid.uuid4().hex}.{ext}"
        try:
            ensure_bucket()
            minio_client.put_object(MINIO_BUCKET, object_name, io.BytesIO(file_data),
                                    length=len(file_data), content_type=ct)
        except Exception as e:
            current_app.logger.warning(f"MinIO verify upload failed: {e}")
            local_path = os.path.join(_UPLOAD_LOCAL_DIR, object_name)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, 'wb') as fh:
                fh.write(file_data)
        existing['vm'] = object_name
        existing['vs'] = 'media'

    if not link and not (file and file.filename):
        return jsonify({'error': 'Provide a link or upload media'}), 400

    n.body = json.dumps(existing)
    db.session.commit()

    # Bust the stats cache so rank judge re-runs on next stats fetch
    cache = Note.query.filter_by(
        user_id=session['user_id'], entry_type='stats_cache', is_deleted=False
    ).first()
    if cache:
        db.session.delete(cache)
        db.session.commit()

    desc, proof, verified, vlink = _parse_ach_body(n.body)
    return jsonify({'id': n.id, 'title': n.title, 'desc': desc, 'proof': proof,
                    'verified': verified, 'vlink': vlink})


# ── Habits API ───────────────────────────────────────────────────────────────

@pug_bp.route('/pug/api/habits', methods=['GET'])
@limiter.limit("60 per minute")
def get_habits():
    err = login_required_api()
    if err: return err
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    from datetime import date
    habits = Habit.query.filter_by(user_id=session['user_id'], is_active=True).order_by(Habit.created_at).all()
    today = date.today()
    result = []
    for h in habits:
        log = HabitLog.query.filter_by(habit_id=h.id, date=today).first()
        d = h.to_dict()
        d['done_today'] = log.done if log else False
        result.append(d)
    return jsonify(result)


@pug_bp.route('/pug/api/habits', methods=['POST'])
@limiter.limit("20 per minute")
def create_habit():
    err = login_required_api()
    if err: return err
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()[:120]
    if not name:
        return jsonify({'error': 'name required'}), 400
    from distro.svg.models.habit import Habit
    h = Habit(user_id=session['user_id'], name=name)
    db.session.add(h)
    db.session.commit()
    return jsonify(h.to_dict()), 201


@pug_bp.route('/pug/api/habits/<int:habit_id>', methods=['DELETE'])
@limiter.limit("20 per minute")
def delete_habit(habit_id):
    err = login_required_api()
    if err: return err
    from distro.svg.models.habit import Habit
    h = Habit.query.filter_by(id=habit_id, user_id=session['user_id']).first_or_404()
    db.session.delete(h)
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/habits/<int:habit_id>/toggle', methods=['POST'])
@limiter.limit("60 per minute")
def toggle_habit(habit_id):
    err = login_required_api()
    if err: return err
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    from datetime import date
    from sqlalchemy.exc import IntegrityError
    h = Habit.query.filter_by(id=habit_id, user_id=session['user_id']).first_or_404()
    today = date.today()
    log = HabitLog.query.filter_by(habit_id=habit_id, date=today).first()
    if log:
        log.done = not log.done
    else:
        log = HabitLog(habit_id=habit_id, date=today, done=True)
        db.session.add(log)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        log = HabitLog.query.filter_by(habit_id=habit_id, date=today).first()
        log.done = not log.done
        db.session.commit()
    return jsonify({'done': log.done})


@pug_bp.route('/pug/api/habits/history', methods=['GET'])
@limiter.limit("20 per minute")
def habits_history():
    err = login_required_api()
    if err: return err
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    from datetime import date, timedelta
    days = min(int(request.args.get('days', 30)), 90)
    user_id = session['user_id']
    habits = Habit.query.filter_by(user_id=user_id, is_active=True).all()
    if not habits:
        return jsonify([])
    habit_ids = [h.id for h in habits]
    today = date.today()
    result = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        done = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date == d,
            HabitLog.done == True
        ).count()
        result.append({'date': d.isoformat(), 'pct': round((done / len(habit_ids)) * 100)})
    return jsonify(result)


@pug_bp.route('/pug/api/weather', methods=['GET'])
def proxy_weather():
    err = login_required_api()
    if err: return err
    try:
        import requests as req
        try:
            lat = float(request.args.get('lat', '30.7333'))
            lon = float(request.args.get('lon', '76.7794'))
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                raise ValueError('out of range')
        except (ValueError, TypeError):
            return jsonify({'error': 'invalid coordinates'}), 400
        r = req.get(
            f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true',
            timeout=8
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        current_app.logger.error(f'[proxy_weather] {type(e).__name__}: {e}')
        return jsonify({'error': 'unavailable'}), 502


@pug_bp.route('/pug/api/wisdom', methods=['GET'])
def proxy_wisdom():
    err = login_required_api()
    if err: return err
    import requests as req
    import random
    try:
        if random.random() > 0.5:
            r = req.get('https://uselessfacts.jsph.pl/api/v2/facts/random', timeout=8)
            r.raise_for_status()
            return jsonify({'text': r.json().get('text', '')})
        else:
            r = req.get('https://dummyjson.com/quotes/random', timeout=8)
            r.raise_for_status()
            d = r.json()
            q, a = d.get('quote', ''), d.get('author', '')
            if not q:
                raise ValueError('empty quote')
            return jsonify({'text': f'"{q}" — {a}'})
    except Exception:
        return jsonify({'error': 'unavailable'}), 502


@pug_bp.route('/pug/api/feedback', methods=['POST'])
def submit_feedback():
    err = login_required_api()
    if err: return err

    data     = request.get_json(silent=True) or {}
    kind     = data.get('kind', 'general')   # 'feature' | 'report'
    rtype    = data.get('rtype', '')          # bug / content / other (reports only)
    message  = data.get('message', '').strip()
    if not message:
        return jsonify({'error': 'Message is empty'}), 400

    import html as _html

    user_id  = session.get('user_id')
    username = session.get('username', 'Unknown')
    distro   = session.get('distro', 'Unknown')

    from shared.auth.user import User
    user       = db.session.get(User, user_id)
    user_email = user.email if user else 'unknown'

    # Escape all user-controlled values before inserting into HTML email
    s_username   = _html.escape(username)
    s_user_email = _html.escape(user_email)
    s_distro     = _html.escape(distro)
    s_message    = _html.escape(message)

    if kind == 'feature':
        subject = f'[Veyra Feature Request] {username}'
        heading = 'Feature Request'
    elif kind == 'giftcard':
        subject = f'[Veyra Gift Card] {username}'
        heading = 'Amazon Pay Gift Card'
    else:
        tag     = f' — {rtype.title()}' if rtype else ''
        subject = f'[Veyra Report{tag}] {username}'
        heading = f'Report{tag}'

    email_html = f"""
    <h2 style="font-family:sans-serif;">{heading}</h2>
    <table style="font-family:sans-serif;font-size:14px;">
      <tr><td><b>User</b></td><td>{s_username}</td></tr>
      <tr><td><b>Email</b></td><td>{s_user_email}</td></tr>
      <tr><td><b>Distro</b></td><td>{s_distro}</td></tr>
    </table>
    <hr>
    <p style="font-family:sans-serif;font-size:15px;white-space:pre-wrap;">{s_message}</p>
    """

    try:
        from shared.auth.auth_route import _send_email
        _send_email('veyrasupportus@gmail.com', subject, email_html)
        return jsonify({'status': 'sent'})
    except Exception as e:
        print(f'[feedback] send error: {e}')
        return jsonify({'error': 'Failed to send — try again later'}), 500


_MLC_HF_BASE  = 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
_MLC_LIB_BASE = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_83/base'


def _stream_proxy(upstream_url):
    import requests as req
    from flask import Response, stream_with_context
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
def proxy_mlc_weights(filepath):
    err = login_required_api()
    if err: return err
    try:
        return _stream_proxy(f'{_MLC_HF_BASE}/{filepath}')
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@pug_bp.route('/pug/mlc-lib/<path:filename>')
def proxy_mlc_lib(filename):
    err = login_required_api()
    if err: return err
    try:
        return _stream_proxy(f'{_MLC_LIB_BASE}/{filename}')
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@pug_bp.route('/pug/api/blinkbot-debug', methods=['GET'])
def blinkbot_debug():
    err = login_required_api()
    if err: return err
    hf_url = os.environ.get('BLINKBOT_MODEL_URL', '')
    token  = os.environ.get('HF_TOKEN', '')
    return jsonify({
        'BLINKBOT_MODEL_URL': ('SET (' + hf_url[:40] + '...)') if hf_url else 'NOT SET',
        'HF_TOKEN':           'SET' if token else 'NOT SET',
        'BLINK_PATH_exists':  os.path.exists(_BLINK_PATH),
        'BUDDY_PATH_exists':  os.path.exists(_BUDDY_PATH),
    })


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
    # Always serve model through our proxy so HF_TOKEN stays server-side
    hf_url    = os.environ.get('BLINKBOT_MODEL_URL')
    model_url = '/pug/install/blinkbot-model.gguf' if (hf_url or os.path.exists(_BLINK_PATH)) else None

    resp = jsonify({
        'system_prompt': BLINKBOT_SYSTEM + ctx_block,
        'user_context':  user_context,
        'model_url':     model_url,
    })
    resp.headers['Cache-Control'] = 'no-store'
    return resp


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
    host = re.sub(r'[^a-zA-Z0-9.\-:_]', '', request.host)
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
echo "Then refresh the Veyra page — BlinkBot will activate automatically."
echo ""
"""
    from flask import make_response
    r = make_response(script)
    r.headers['Content-Type']        = 'text/plain'
    r.headers['Content-Disposition'] = 'attachment; filename=setup_blinkbot.sh'
    return r


def _hf_fetch(method, url, token, stream=False, timeout=30):
    """
    HuggingFace LFS files redirect to S3/CDN presigned URLs.
    S3 rejects requests that have both a presigned signature AND an Authorization header.
    So we follow redirects manually and strip the auth header the moment we leave huggingface.co.
    """
    import requests as req
    from urllib.parse import urlparse
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    for _ in range(8):  # max redirect hops
        r = req.request(method, url, headers=headers,
                        allow_redirects=False, stream=stream, timeout=timeout)
        if r.status_code not in (301, 302, 303, 307, 308):
            return r
        location = r.headers.get('Location', '')
        if not location:
            return r
        url = location
        # Only send HF token to HuggingFace — never to S3/CDN
        headers = {'Authorization': f'Bearer {token}'} if (
            token and 'huggingface.co' in urlparse(url).netloc
        ) else {}
    return r


@pug_bp.route('/pug/install/blinkbot-model.gguf', methods=['GET', 'HEAD'])
def install_blinkbot_model():
    """
    Serve BlinkBot GGUF to the browser (wllama) with full range-request support.
    Ranges let wllama chunk the download — each chunk is a short request that
    won't get killed by the HF Space proxy timeout.
    """
    err = login_required_page()
    if err: return err
    from flask import request as flask_request, send_file

    if not os.path.exists(_BLINK_PATH):
        return Response(status=404)

    file_size = os.path.getsize(_BLINK_PATH)

    if flask_request.method == 'HEAD':
        return Response(status=200, headers={
            'Content-Type':   'application/octet-stream',
            'Content-Length': str(file_size),
            'Accept-Ranges':  'bytes',
        })

    # Range request support — wllama will use this to download in chunks
    range_header = flask_request.headers.get('Range')
    if range_header:
        try:
            byte_range = range_header.replace('bytes=', '').split('-')
            start = int(byte_range[0])
            end   = int(byte_range[1]) if byte_range[1] else file_size - 1
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

    # Full file (wllama will use range requests if it needs chunking)
    resp = send_file(_BLINK_PATH, mimetype='application/octet-stream', conditional=True)
    resp.headers['Accept-Ranges'] = 'bytes'
    return resp


@pug_bp.route('/pug/install/blinkbot')
def install_blinkbot():
    """
    One-liner installer served as a bash script.
    Usage: curl -fsSL http://<host>/pug/install/blinkbot | bash
    No auth required — this runs in the user's terminal, not the browser.
    """
    from flask import make_response
    host = re.sub(r'[^a-zA-Z0-9.\-:_]', '', request.host)

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
    PLIST="$HOME/Library/LaunchAgents/com.veyra.ollama-cors.plist"
    cat > "$PLIST" <<\'PLISTEOF\'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.veyra.ollama-cors</string>
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
echo "  ║  Go back to the Veyra page — it will             ║"
echo "  ║  activate automatically within a few seconds.    ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""
'''

    r = make_response(script)
    r.headers['Content-Type']        = 'text/plain; charset=utf-8'
    r.headers['Content-Disposition'] = 'inline'
    return r