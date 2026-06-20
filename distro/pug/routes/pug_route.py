"""
distro/pug/routes/pug_route.py — the pug (Ocellus) distro's entire backend.

This is the biggest file in the project: every pug API endpoint lives here, registered on
the `pug_bp` blueprint (all URLs start with /pug/...). Broadly it covers:

  • Pages & auth helpers        — /pug/home, login_required_api(), admin_required_api()
  • Notes / goals / dreams      — personal entries (stored encrypted)
  • Habits & consistency        — habit tracking and streak data
  • Skills, stats & ranks       — the skill-ranking identity system
  • Community feed              — posts, comments, reactions, ShowOff actions
  • Direct messages             — 1:1 chat
  • Moderation                  — reports, blocking, admin review queues
  • AI (BlinkBot / BuddyBot)    — on-device + Groq-cloud chat, context assembly
  • Eyes wallet & marketplace   — currency top-up / sell-back / transactions
  • Media uploads               — images/video to object storage (MinIO/B2)
  • Misc                        — weather, events, wisdom, feedback, profile

Conventions used throughout:
  • Most endpoints start with `err = login_required_api(); if err: return err` to require login.
  • A `Note` row with a given `entry_type` backs many features (posts, comments, DMs, …).
  • @limiter.limit(...) rate-limits the spammable/abusable endpoints.
"""
import os
import re
import uuid
import io
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
from .notes import Note, Wallet, WalletTx, EyeRate, refresh_eye_rates, AmaMessage, PostReport, UserBlock, UserReport, SharedMedia
from .bot_prompts import BLINKBOT_SYSTEM, BLINKBOT_TRANSLATE_SYSTEM, BUDDYBOT_SYSTEM
from shared.extensions import limiter

try:
    from llama_cpp import Llama
    _LLAMA_OK = True
except ImportError:
    _LLAMA_OK = False

_DATA_DIR   = '/data' if os.path.isdir('/data') else os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
_MODELS_DIR = os.path.join(_DATA_DIR, 'distro', 'pug', 'llm')
_BLINK_PATH = os.environ.get('BLINKBOT_PATH', os.path.join(_MODELS_DIR, 'blinkbot', 'BlinkBot_0.5B_v4.Q4_K_M.gguf'))
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


# ─────────────────────────────────────────────────────────────────────────────
# BLINKBOT v4 TRANSLATOR  —  user text → JSON actions → DB mutations
#
# The on-device 0.5B model emits "<think>…</think>\n{\"actions\":[…],
# \"needs_groq\":bool, \"reply\":\"…\"}". We parse it (hard-guarded — the model
# output is NEVER trusted), execute the safe actions, gate the destructive ones
# (remove_habit/delete_log/edit_log) behind an explicit confirm round-trip, and
# append every mutation to a per-user action log so `undo` can reverse the last.
# ─────────────────────────────────────────────────────────────────────────────
_BLINK_DESTRUCTIVE = {'remove_habit', 'delete_log', 'edit_log'}
_BLINK_NOTE_TITLE  = 'Passed by bot'   # title for notes BlinkBot logs; also sorts them last
_BLINK_STOPWORDS   = {'the', 'a', 'an', 'my', 'me', 'i', 'log', 'logs', 'entry',
                      'that', 'this', 'one', 'of', 'for', 'from', 'about', 'it',
                      'remove', 'delete', 'take', 'off', 'get', 'rid', 'scratch'}


def _blink_parse(raw):
    """Pull the JSON object out of '<think>…</think>\\n{json}'. Returns a dict
    with guaranteed keys, or None if nothing valid could be extracted."""
    if not raw:
        return None
    clean = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()
    start, end = clean.find('{'), clean.rfind('}')
    if start == -1 or end == -1 or end < start:
        return None
    try:
        obj = json.loads(clean[start:end + 1])
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    if not isinstance(obj.get('actions'), list):
        obj['actions'] = []
    obj.setdefault('needs_groq', False)
    obj.setdefault('reply', '')
    return obj


def _call_blinkbot_translate(message):
    """Run the v4 translator on one message. Returns the parsed dict or None."""
    model = _get_blinkbot()
    out = model.create_chat_completion(
        messages=[
            {'role': 'system', 'content': BLINKBOT_TRANSLATE_SYSTEM},
            {'role': 'user',   'content': message},
        ],
        max_tokens=256,
        temperature=0.1,
        stop=['<|im_end|>', '</s>'],
    )
    return _blink_parse(out['choices'][0]['message']['content'])


def _blink_find_habit(user_id, name):
    """Find this user's active habit by name (case-insensitive); None if absent."""
    from distro.svg.models.habit import Habit
    n = (name or '').strip().lower()
    if not n:
        return None
    return Habit.query.filter(
        Habit.user_id == user_id,
        db.func.lower(Habit.name) == n,
        Habit.is_active == True,
    ).first()


# Stopwords + a few irregular stems so e.g. "ran" maps to a "Run" habit.
_BLINK_STOP = {
    'the', 'a', 'an', 'my', 'me', 'i', 'to', 'of', 'and', 'for', 'in', 'on', 'at',
    'did', 'do', 'done', 'got', 'get', 'just', 'today', 'now', 'some', 'this',
    'that', 'was', 'is', 'am', 'are', 'have', 'had', 'has', 'with', 'it', 'its',
    'out', 'up', 'off', 'then', 'so', 'about', 'finished', 'ended', 'end',
}
_BLINK_IRREGULAR = {
    'ran': 'run', 'running': 'run', 'swam': 'swim', 'swimming': 'swim',
    'ate': 'eat', 'eating': 'eat', 'slept': 'sleep', 'sleeping': 'sleep',
    'sang': 'sing', 'singing': 'sing', 'wrote': 'write', 'writing': 'write',
}


def _blink_stem(w):
    """Crude stemmer: irregular map first, then strip a common suffix."""
    w = _BLINK_IRREGULAR.get(w, w)
    for suf in ('ing', 'ed', 'es', 's'):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[:-len(suf)]
    return w


def _blink_norm(s):
    """Lowercase and glue a number to a following unit ("5 km" → "5km", "7 hrs" →
    "7hrs") so a quantity matches a habit like "5 km Run" even without the verb."""
    import re
    return re.sub(r'(\d)\s+([a-z])', r'\1\2', (s or '').lower())


def _blink_match_habit_from_text(user_id, text):
    """Backend safety-net for the 'parse → backend acts' design: the tiny on-device
    model often files a habit as a note/achievement. If the free text clearly refers
    to one of the user's ACTIVE habits, return it so we can tick it too. Conservative
    on purpose — short/common words are ignored, and a match must include a
    DISTINCTIVE token (a 5+ char word, or a quantity like 5km/400m/7hrs) or cover the
    whole habit name, to limit false ticks."""
    from distro.svg.models.habit import Habit
    import difflib
    import re
    tw = {_blink_stem(w) for w in re.findall(r'[a-z0-9]+', _blink_norm(text))
          if w not in _BLINK_STOP}
    if not tw:
        return None
    has_digit = lambda s: any(c.isdigit() for c in s)
    best, best_hits = None, 0
    for h in Habit.query.filter_by(user_id=user_id, is_active=True).all():
        htoks = [_blink_stem(w) for w in re.findall(r'[a-z0-9]+', _blink_norm(h.name))
                 if w not in _BLINK_STOP and len(w) >= 3]
        if not htoks:
            continue
        matched = []   # (token, was_exact)
        for ht in htoks:
            if ht in tw:
                matched.append((ht, True))
            elif any(len(ht) >= 5 and (ht in x or x in ht) for x in tw) \
                    or any(difflib.SequenceMatcher(None, ht, x).ratio() >= 0.85 for x in tw):
                matched.append((ht, False))   # fuzzy/substring — only trusted for long words
        if not matched:
            continue
        # Strong enough to tick = a DISTINCTIVE token matched (a quantity like 5km,
        # a 5+ char word, or an exact whole-word hit ≥3 chars like "run"/"sing"), or
        # the whole habit name was covered. Fuzzy hits on short words don't qualify —
        # keeps "single" from ticking "sing".
        distinctive = any(has_digit(m) or len(m) >= 5 or (exact and len(m) >= 3)
                          for (m, exact) in matched)
        if (distinctive or len(matched) == len(htoks)) and len(matched) > best_hits:
            best, best_hits = h, len(matched)
    return best


def _blink_tick_habit_obj(user_id, h, today, performed):
    """Mark a habit done for `today` (idempotent) and log it for undo."""
    from distro.svg.models.habit_log import HabitLog
    hl = HabitLog.query.filter_by(habit_id=h.id, date=today).first()
    if hl:
        hl.done = True
    else:
        db.session.add(HabitLog(habit_id=h.id, date=today, done=True))
    performed.append(f"ticked {h.name}")
    _blink_log_action(user_id, f"tick {h.name}",
                      {'undo': 'untick_habit', 'habit_id': h.id, 'date': today.isoformat()})


def _blink_log_action(user_id, summary, undo_spec):
    """Append one entry to the BlinkBot action log (for undo)."""
    n = Note(user_id=user_id, entry_type='blink_action_log')
    n.title = summary[:120]
    n.body  = json.dumps(undo_spec)
    db.session.add(n)


def _blink_describe(action):
    """Human-readable summary of a destructive action, for the confirm prompt."""
    t = action.get('type')
    if t == 'remove_habit':
        return f"Remove the “{action.get('name', '')}” habit?"
    if t == 'delete_log':
        return f"Delete the entry “{action.get('target', '')}”?"
    if t == 'edit_log':
        return f"Change “{action.get('target', '')}” to “{action.get('value', '')}”?"
    return "Confirm this action?"


def _blink_resolve_entry(user_id, target):
    """Best-effort: map a free-text descriptor ('yesterday's run', 'typing metric')
    to one of the user's recent Note entries by keyword overlap. Returns a Note or None."""
    target_tokens = {w for w in re.findall(r'[a-z0-9]+', (target or '').lower())
                     if w not in _BLINK_STOPWORDS}
    if not target_tokens:
        return None
    recent = Note.query.filter(
        Note.user_id == user_id,
        Note.entry_type.in_(['note', 'metric', 'achievement']),
        Note.is_deleted == False,
    ).order_by(Note.created_at.desc()).limit(60).all()

    best, best_score = None, 0
    for n in recent:
        hay = f"{n.title or ''} {n.body or ''} {n.entry_type}".lower()
        hay_tokens = set(re.findall(r'[a-z0-9]+', hay))
        score = len(target_tokens & hay_tokens)
        if score > best_score:
            best, best_score = n, score
    return best if best_score > 0 else None


def _blink_undo_last(user_id):
    """Reverse the most recent logged BlinkBot mutation. Returns a summary string."""
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog

    log = Note.query.filter_by(
        user_id=user_id, entry_type='blink_action_log', is_deleted=False
    ).order_by(Note.created_at.desc()).first()
    if not log:
        return "nothing to undo"
    try:
        spec = json.loads(log.body or '{}')
    except Exception:
        spec = {}
    kind = spec.get('undo')

    if kind == 'untick_habit':
        hl = HabitLog.query.filter_by(habit_id=spec.get('habit_id')).filter(
            HabitLog.date == spec.get('date')).first()
        if hl:
            hl.done = False
    elif kind == 'remove_habit':            # undo an add_habit
        h = Habit.query.get(spec.get('habit_id'))
        if h:
            h.is_active = False
    elif kind == 'readd_habit':             # undo a remove_habit
        h = Habit.query.get(spec.get('habit_id'))
        if h:
            h.is_active = True
    elif kind == 'delete_note':             # undo a create
        n = Note.query.get(spec.get('note_id'))
        if n:
            n.is_deleted = True
    elif kind == 'restore_note':            # undo a delete_log
        n = Note.query.get(spec.get('note_id'))
        if n:
            n.is_deleted = False
    elif kind == 'edit_note':               # undo an edit_log
        n = Note.query.get(spec.get('note_id'))
        if n:
            n.body = spec.get('old', '')

    log.is_deleted = True   # consume the log entry
    return "undone"


def _blink_execute(user_id, actions, confirmed=False, today=None):
    """Execute a list of action dicts. Destructive actions are skipped (returned as
    pending_confirm) unless `confirmed` is True. `today` is the user's LOCAL date
    (the server runs UTC; without this, near-midnight ticks land on the wrong day —
    the habits tab is local-day, so the tick would look missing). Returns a result dict."""
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    from datetime import date as _date

    performed, pending, nav = [], [], None
    if today is None:
        today = _date.today()

    for a in (actions or []):
        if not isinstance(a, dict):
            continue
        t = a.get('type')

        if t in _BLINK_DESTRUCTIVE and not confirmed:
            pending.append({'action': a, 'summary': _blink_describe(a)})
            continue

        if t == 'tick_habit':
            name = (a.get('name') or '').strip()
            if not name:
                continue
            # Exact match first, then fuzzy — so the model's "Sprint" / "Dev" tick the
            # real "400m Sprint" / "Software Development" instead of spawning duplicates.
            h = _blink_find_habit(user_id, name) or _blink_match_habit_from_text(user_id, name)
            if not h:                       # genuinely new → ticking implies it exists, create
                h = Habit(user_id=user_id, name=name, track_type='manual', is_active=True)
                db.session.add(h)
                db.session.flush()
            _blink_tick_habit_obj(user_id, h, today, performed)

        elif t == 'add_habit':
            name = (a.get('name') or '').strip()
            if not name:
                continue
            if _blink_find_habit(user_id, name):
                performed.append(f"{name} is already a habit")
            else:
                h = Habit(user_id=user_id, name=name, track_type='manual', is_active=True)
                db.session.add(h)
                db.session.flush()
                performed.append(f"added habit “{name}”")
                _blink_log_action(user_id, f"add habit {name}",
                                  {'undo': 'remove_habit', 'habit_id': h.id})

        elif t == 'remove_habit':
            name = (a.get('name') or '').strip()
            h = _blink_find_habit(user_id, name)
            if h:
                h.is_active = False
                performed.append(f"removed habit “{h.name}”")
                _blink_log_action(user_id, f"remove habit {h.name}",
                                  {'undo': 'readd_habit', 'habit_id': h.id})
            else:
                performed.append(f"no active habit named “{name}”")

        elif t == 'log_note':
            txt = (a.get('text') or '').strip()
            if not txt:
                continue
            n = Note(user_id=user_id, entry_type='note')
            n.title = _BLINK_NOTE_TITLE          # so it's not "untitled" + sorts to the bottom
            n.body = txt
            db.session.add(n)
            db.session.flush()
            performed.append("noted")
            _blink_log_action(user_id, f"note: {txt[:40]}",
                              {'undo': 'delete_note', 'note_id': n.id})
            # Safety-net: the words clearly name a tracked habit → tick it too.
            _hab = _blink_match_habit_from_text(user_id, txt)
            if _hab:
                _blink_tick_habit_obj(user_id, _hab, today, performed)

        elif t == 'log_achievement':
            title = (a.get('title') or '').strip()
            if not title:
                continue
            n = Note(user_id=user_id, entry_type='achievement')
            n.title = title
            db.session.add(n)
            db.session.flush()
            performed.append("logged achievement")
            _blink_log_action(user_id, f"achievement: {title[:40]}",
                              {'undo': 'delete_note', 'note_id': n.id})
            _hab = _blink_match_habit_from_text(user_id, title)
            if _hab:
                _blink_tick_habit_obj(user_id, _hab, today, performed)

        elif t == 'log_metric':
            skill = (a.get('skill') or '').strip()
            value = (a.get('value') or '').strip()
            if not skill:
                continue
            n = Note(user_id=user_id, entry_type='metric')
            n.title = skill
            n.body  = value
            db.session.add(n)
            db.session.flush()
            performed.append(f"logged {skill}")
            _blink_log_action(user_id, f"metric: {skill} {value}",
                              {'undo': 'delete_note', 'note_id': n.id})

        elif t == 'suggest_skill':
            name = (a.get('name') or '').strip()
            if not name:
                continue
            sheet = _get_cached_sheet(user_id) or {}
            sugg  = sheet.get('suggestions', [])
            known = {s.get('name') for s in sugg} | {s.get('name') for s in sheet.get('skills', [])}
            if name not in known:
                sugg.append({'name': name, 'class_id': '', 'class_label': ''})
                sheet['suggestions'] = sugg
                _save_cached_sheet(user_id, sheet)
            performed.append(f"suggested {name}")

        elif t == 'delete_log':
            n = _blink_resolve_entry(user_id, a.get('target', ''))
            if n:
                n.is_deleted = True
                label = (n.title or n.body or '')[:40]
                performed.append(f"removed “{label}”")
                _blink_log_action(user_id, f"delete entry {n.id}",
                                  {'undo': 'restore_note', 'note_id': n.id})
            else:
                performed.append(f"couldn't find “{a.get('target', '')}” to remove")

        elif t == 'edit_log':
            n = _blink_resolve_entry(user_id, a.get('target', ''))
            value = (a.get('value') or '').strip()
            if n:
                old = n.body
                n.body = value
                performed.append(f"updated “{(n.title or '')[:40]}” → {value}")
                _blink_log_action(user_id, f"edit entry {n.id}",
                                  {'undo': 'edit_note', 'note_id': n.id, 'old': old})
            else:
                performed.append(f"couldn't find “{a.get('target', '')}” to edit")

        elif t == 'undo':
            performed.append(_blink_undo_last(user_id))

        elif t == 'open_profile':
            nav = {'action': 'open_profile', 'target': (a.get('target') or '').strip()}
            performed.append("opening profile")

        elif t == 'logout':
            nav = {'action': 'logout'}
            performed.append("logging out")

        else:
            # Unknown/hallucinated type (e.g. the model emitting "tick_achievement").
            # If any text field clearly names a habit, tick it; otherwise ignore safely.
            blob = ' '.join(str(a.get(k, '')) for k in ('name', 'title', 'text', 'target'))
            _hab = _blink_match_habit_from_text(user_id, blob) if blob.strip() else None
            if _hab:
                _blink_tick_habit_obj(user_id, _hab, today, performed)

    db.session.commit()
    return {'performed': performed, 'pending_confirm': pending, 'nav': nav}


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
        "6. CLASS DETECTION — extract the specific sub-class from the evidence text when possible.\n"
        "   Running classes: 1km, 2km, 3km, 4km, 5km, 10km, 15km, 20km, half_marathon, marathon, 25km, 50km, 75km, 100km.\n"
        "   'run 5km', 'ran 5k', '5km run', 'Couch to 5k' → class_id: '5km', class_label: '5 km'.\n"
        "   'run 10km' → class_id: '10km', class_label: '10 km'. 'marathon training' → class_id: 'marathon', class_label: 'Marathon (42.2 km)'.\n"
        "   Powerlifting/Weightlifting → detect lift: squat, bench, deadlift, snatch, clean_jerk, or pl_total.\n"
        "   Chess → class_id: 'elo', class_label: 'ELO Rating'.\n"
        "   Language skills → use the exam/language code: cefr, jlpt, hsk, goethe.\n"
        "   If no specific class can be determined, leave class_id and class_label as empty strings.\n"
        "7. Simple English throughout. Common words only.\n\n"
        "Output ONLY valid JSON:\n"
        '{"class_official":"role based on achievements (Blank Slate if none)",'
        '"class_playful":"same role with flair",'
        '"personality":"2-4 word archetype",'
        '"personality_desc":"One sentence about their mindset.",'
        '"bio":"One sentence. Who they actually are right now.",'
        '"skills":['
        '{"name":"plain skill name","rank":"E","verified":false,"context":"","note":"","class_id":"5km","class_label":"5 km"}'
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
        """Post-process: unverified = rank E-, no context, standardised note; preserve class fields."""
        if not sheet or 'skills' not in sheet:
            return sheet
        for s in sheet['skills']:
            s.setdefault('class_id', '')
            s.setdefault('class_label', '')
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

@pug_bp.before_request
def _ping_last_seen():
    uid = session.get('user_id')
    if not uid:
        return
    now = datetime.utcnow()
    from shared.auth.user import User
    try:
        u = User.query.get(uid)
        if u:
            dirty = False
            if u.distro == 'ThePug':
                u.distro = 'Ocellus'
                dirty = True
            if dirty or session.get('distro') == 'ThePug':
                session['distro'] = 'Ocellus'
            if u.last_seen is None or (now - u.last_seen).total_seconds() > 120:
                u.last_seen = now
                dirty = True
            if dirty:
                db.session.commit()
    except Exception:
        pass

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



# ═════════════════════════════════════════════════════════════════════════════
# REQUEST HELPERS — auth guards & object-storage bucket
# ═════════════════════════════════════════════════════════════════════════════
def ensure_bucket():
    """Create the object-storage bucket if it doesn't exist yet (idempotent)."""
    try:
        if not minio_client.bucket_exists(MINIO_BUCKET):
            # R2 buckets must be created in the Cloudflare dashboard — skip auto-create
            if 'r2.cloudflarestorage.com' not in MINIO_ENDPOINT:
                minio_client.make_bucket(MINIO_BUCKET)
    except S3Error as e:
        current_app.logger.warning(f'Storage bucket check failed: {e}')


def login_required_page():
    """Page guard: redirect to login when not authenticated; None if OK."""
    if not session.get('user_id'):
        return redirect(url_for('svg.login'))
    if session.get('distro') != 'Ocellus':
        return redirect(url_for('svg.login'))
    return None


def login_required_api():
    """API guard: return a 401 JSON error when not authenticated; None if OK."""
    if not session.get('user_id'):
        return jsonify({'error': 'Not authenticated'}), 401
    if session.get('distro') != 'Ocellus':
        return jsonify({'error': 'Forbidden'}), 403
    return None


def _admin_allowlist():
    """Admins, defined in the Render env (PUG_ADMIN_EMAILS, comma-separated emails
    and/or usernames). Env-based so admin can't be granted via a DB compromise and
    needs no live-DB write to set up — just edit the env var for the ~3 accounts."""
    raw = os.environ.get('PUG_ADMIN_EMAILS', '')
    return {x.strip().lower() for x in raw.split(',') if x.strip()}


def _is_admin(user_id):
    """True if the user is in the env allowlist OR carries the legacy is_admin DB
    flag. Server-side only — never trusts the client/session alone."""
    if not user_id:
        return False
    from shared.auth.user import User
    u = db.session.get(User, user_id)
    if not u:
        return False
    if u.is_admin:
        return True
    allow = _admin_allowlist()
    return (u.email or '').lower() in allow or (u.username or '').lower() in allow


def admin_required_api():
    """Gate for admin-only endpoints — checks the env allowlist / is_admin flag in
    the DB, never the session alone."""
    err = login_required_api()
    if err:
        return err
    if not _is_admin(session['user_id']):
        return jsonify({'error': 'Forbidden'}), 403
    return None


# ── Escalating mute (admin moderation) ────────────────────────────────────────
# Each confirmed report an admin acts on bumps violation_count and mutes the user
# longer: 1d → 3d → 7d → 30d → 1y (capped). A muted user can't post/comment/DM.
_MUTE_TIERS = [timedelta(days=1), timedelta(days=3), timedelta(days=7),
               timedelta(days=30), timedelta(days=365)]


def _mute_until_for(violations):
    """Mute end-time for the Nth violation (1-based); caps at the longest tier."""
    tier = _MUTE_TIERS[min(max(violations, 1) - 1, len(_MUTE_TIERS) - 1)]
    return datetime.utcnow() + tier


def _muted_block():
    """Return (jsonify, 403) if the caller is currently muted, else None — gates
    the create-post / comment / DM-send endpoints."""
    from shared.auth.user import User
    u = db.session.get(User, session['user_id'])
    if u and u.muted_until and u.muted_until > datetime.utcnow():
        return jsonify({'error': 'muted', 'muted_until': u.muted_until.isoformat()}), 403
    return None


def _protect_reporter(reporter_id, reported_id):
    """After a report, auto-block so the reported user can't see or retaliate against
    the reporter (blocks hide both directions via _blocked_ids). Caller commits."""
    if reporter_id == reported_id:
        return
    if not UserBlock.query.filter_by(blocker_id=reporter_id, blocked_id=reported_id).first():
        db.session.add(UserBlock(blocker_id=reporter_id, blocked_id=reported_id))



# ═════════════════════════════════════════════════════════════════════════════
# PAGES
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/home')
def home():
    """Serve the pug single-page app shell (the home page)."""
    guard = login_required_page()
    if guard:
        return guard
    # Admin (the owner) runs an 80%-scaled system, so exempt that account from the
    # site-wide zoom:0.8 (it would otherwise double-scale for them). See kstyle.
    from shared.auth.user import User
    _u = db.session.get(User, session.get('user_id'))
    return render_template('pug/home.html',
                           username=session.get('username', 'User'),
                           distro=session.get('distro', 'Ocellus'),
                           is_admin=_is_admin(session.get('user_id')),
                           zoom_exempt=bool(_u and _u.is_admin))



# ═════════════════════════════════════════════════════════════════════════════
# NOTES / GOALS / DREAMS  (personal entries, stored encrypted)
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/notes', methods=['GET'])
def get_notes():
    """List the user's notes."""
    err = login_required_api()
    if err: return err
    notes = Note.query.filter_by(
        user_id=session['user_id'], entry_type='note', is_deleted=False
    ).order_by(Note.updated_at.desc()).all()
    # Titles are encrypted, so can't sort bot-notes last in SQL — do it in Python.
    # Stable sort preserves updated_at-desc within each group; bot-notes (True) sink.
    notes.sort(key=lambda n: n.title == _BLINK_NOTE_TITLE)
    return jsonify([n.to_dict() for n in notes])


@pug_bp.route('/pug/api/notes', methods=['POST'])
def save_note():
    """Create or update a note."""
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
    """Delete a note."""
    err = login_required_api()
    if err: return err
    note = Note.query.filter_by(id=note_id, user_id=session['user_id']).first_or_404()
    note.is_deleted = True
    db.session.commit()
    return jsonify({'status': 'success'})


@pug_bp.route('/pug/api/goals', methods=['GET'])
def get_goals():
    """List the user's active goals."""
    err = login_required_api()
    if err: return err
    goals = Note.query.filter_by(
        user_id=session['user_id'], entry_type='goal', is_deleted=False
    ).order_by(Note.created_at.asc()).all()
    return jsonify([g.to_dict() for g in goals])


@pug_bp.route('/pug/api/goals', methods=['POST'])
def add_goal():
    """Create a goal."""
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
    """Update a goal (e.g. mark it finished)."""
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
    """Delete a goal."""
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
    """List the user's cancelled goals."""
    err = login_required_api()
    if err: return err
    goals = Note.query.filter_by(
        user_id=session['user_id'], entry_type='goal',
        is_deleted=True, is_finished=False
    ).order_by(Note.updated_at.desc()).limit(20).all()
    return jsonify([g.to_dict() for g in goals])


@pug_bp.route('/pug/api/dream', methods=['GET'])
def get_dream():
    """Get the user's long-term 'dream' entry."""
    err = login_required_api()
    if err: return err
    dream = Note.query.filter_by(
        user_id=session['user_id'], entry_type='dream', is_deleted=False
    ).first()
    return jsonify({'dream': dream.title if dream else None})


@pug_bp.route('/pug/api/dream', methods=['POST'])
def set_dream():
    """Set/update the user's dream entry."""
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



# ═════════════════════════════════════════════════════════════════════════════
# CONSISTENCY & EVENTS
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/consistency', methods=['GET'])
def get_consistency():
    """Return consistency/streak data for the dashboard."""
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
    """List the user's calendar events (entry_type='event')."""
    err = login_required_api()
    if err: return err
    events = Note.query.filter(
        Note.user_id == session['user_id'],
        Note.is_deleted == False,
        Note.entry_type == 'event',
        Note.start_datetime != None
    ).order_by(Note.start_datetime.asc()).all()
    return jsonify([{
        'id': e.id, 'title': e.title,
        'start_datetime': e.start_datetime.isoformat() if e.start_datetime else None,
        'end_datetime':   e.end_datetime.isoformat()   if e.end_datetime   else None,
    } for e in events])


@pug_bp.route('/pug/api/events', methods=['POST'])
def create_event():
    """Add a calendar event. Body: title, start (YYYY-MM-DD), end (optional),
    time (optional HH:MM). Stored as a Note with entry_type='event'."""
    err = login_required_api()
    if err: return err
    data  = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    start = (data.get('start') or '').strip()      # 'YYYY-MM-DD'
    end   = (data.get('end') or '').strip()        # 'YYYY-MM-DD' or empty
    tm    = (data.get('time') or '').strip()       # 'HH:MM' or empty
    if not title or not start:
        return jsonify({'error': 'title and start required'}), 400
    if len(title) > 200:
        return jsonify({'error': 'title too long'}), 400
    try:
        start_dt = datetime.strptime(f"{start} {tm}" if tm else start,
                                     '%Y-%m-%d %H:%M' if tm else '%Y-%m-%d')
        end_dt = datetime.strptime(end, '%Y-%m-%d') if end else None
    except ValueError:
        return jsonify({'error': 'bad date/time'}), 400
    if end_dt and end_dt.date() < start_dt.date():
        return jsonify({'error': 'end before start'}), 400

    e = Note(user_id=session['user_id'], entry_type='event',
             start_datetime=start_dt, end_datetime=end_dt)
    e.title = title
    db.session.add(e)
    db.session.commit()
    return jsonify({'id': e.id, 'title': e.title,
                    'start_datetime': e.start_datetime.isoformat(),
                    'end_datetime': e.end_datetime.isoformat() if e.end_datetime else None})


@pug_bp.route('/pug/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    """Delete one of the user's calendar events."""
    err = login_required_api()
    if err: return err
    e = Note.query.filter_by(id=event_id, user_id=session['user_id'],
                             entry_type='event').first()
    if not e:
        return jsonify({'error': 'not found'}), 404
    e.is_deleted = True
    db.session.commit()
    return jsonify({'ok': True})


_holidays_cache = {}  # (country, year) -> [{date, name}] — in-memory per process


@pug_bp.route('/pug/api/holidays', methods=['GET'])
def get_holidays():
    """Official public holidays for a country/year, proxied + cached from Nager.Date
    (free, no key). Country comes from the client's browser locale. Same-origin so
    the CSP needs no third-party host."""
    err = login_required_api()
    if err: return err
    country = (request.args.get('country') or '').strip().upper()
    try:
        year = int(request.args.get('year') or 0)
    except ValueError:
        year = 0
    if not (len(country) == 2 and country.isalpha() and 2000 <= year <= 2100):
        return jsonify([])
    key = (country, year)
    if key in _holidays_cache:
        return jsonify(_holidays_cache[key])
    import requests as req
    try:
        r = req.get(f'https://date.nager.at/api/v3/PublicHolidays/{year}/{country}', timeout=8)
        if r.status_code != 200:
            return jsonify([])
        data = [{'date': h.get('date'), 'name': h.get('localName') or h.get('name')}
                for h in r.json() if h.get('date')]
        _holidays_cache[key] = data
        return jsonify(data)
    except Exception:
        return jsonify([])



# ═════════════════════════════════════════════════════════════════════════════
# MEDIA UPLOADS & SERVING  (to object storage)
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/upload', methods=['POST'])
@limiter.limit("30 per minute")
def upload_file():
    """Upload a private media file to object storage; return its key/URL."""
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
    """Stream a private media file the caller owns."""
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
    """Upload a shared media file (community/DM); return its key/URL."""
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
    # Record context so DM attachments can be kept private (see serve_media_shared).
    context = 'dm' if (request.form.get('context') == 'dm') else 'post'
    peer_id = request.form.get('peer', type=int) if context == 'dm' else None
    try:
        db.session.add(SharedMedia(object_name=object_name, uploader_id=session['user_id'],
                                   context=context, peer_id=peer_id))
        db.session.commit()
    except Exception:
        db.session.rollback()   # tracking is best-effort; never fail the upload over it
    return jsonify({
        'key':  object_name,
        'url':  url_for('pug.serve_media_shared', object_name=object_name),
        'type': ftype,
    })


@pug_bp.route('/pug/api/media/shared/<path:object_name>')
def serve_media_shared(object_name):
    """Stream a shared media file."""
    err = login_required_api()
    if err: return err
    # Block path traversal and enforce shared/ prefix
    if (not object_name.startswith('shared/')
            or '..' in object_name
            or '\x00' in object_name
            or object_name != object_name.replace('\\', '')):
        return jsonify({'error': 'Forbidden'}), 403
    # DM attachments are private: only the two participants may fetch them. Post media (and
    # legacy uploads with no record) stay public to any logged-in user.
    rec = SharedMedia.query.filter_by(object_name=object_name).first()
    if rec and rec.context == 'dm':
        me = session['user_id']
        if me != rec.uploader_id and me != rec.peer_id:
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



# ═════════════════════════════════════════════════════════════════════════════
# LOCATION & PUBLIC PROFILE
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/location', methods=['POST'])
def save_location():
    """Save the user's location (powers the community "radar" distance feed)."""
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
    """Return another user's public profile (skills, rank, online status)."""
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    u = User.query.get(uid)
    if not u or u.distro != 'Ocellus':
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
        'id':          uid,
        'username':    u.username,
        'rank':        rank,
        'rank_color':  color,
        'sheet':       sheet,
        'is_online':   _is_online(u),
        'connections': _connection_count(uid),
    })



# ═════════════════════════════════════════════════════════════════════════════
# AI ENDPOINTS — Ask / BlinkBot / BuddyBot
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/ask', methods=['POST'])
@limiter.limit("30 per minute")
def ask():
    """Quick-answer endpoint (BlinkBot 'ask')."""
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
    """BlinkBot v4 — on-device translator. Turns a message into actions, runs the
    safe ones, returns destructive ones for confirmation, and routes personality/
    class requests (needs_groq) to the heavier cloud model."""
    err = login_required_api()
    if err: return err

    user_id = session['user_id']
    data    = request.get_json(silent=True) or {}

    # The client sends its LOCAL date (YYYY-MM-DD); ticks must land on the user's day,
    # not the server's UTC day, to match the habits tab. Fall back to server date.
    _local_today = None
    try:
        _ld = (data.get('local_date') or '').strip()
        if _ld:
            from datetime import date as _date
            _local_today = _date.fromisoformat(_ld[:10])
    except Exception:
        _local_today = None

    # Freemium gate: first use auto-starts the free window (the feature can't be used
    # without a running timer — closes the "never call /activate" bypass), then block
    # once the free window and any paid month are over.
    _sub = _blink_ensure_activated(user_id)
    if _sub['expired']:
        return jsonify({'paywall': True, 'monthly_credits': _BLINK_MONTHLY_CREDITS,
                        'reply': f"BlinkBot's free period ended — {_BLINK_MONTHLY_CREDITS} credits/month to keep using it.",
                        'source': 'paywall'}), 402

    # (1) Confirm round-trip: client re-sends a previously-pending destructive action.
    confirm_action = data.get('confirm_action')
    if isinstance(confirm_action, dict) and confirm_action.get('type') in _BLINK_DESTRUCTIVE:
        res = _blink_execute(user_id, [confirm_action], confirmed=True, today=_local_today)
        return jsonify({
            'reply':     '; '.join(res['performed']) or 'done',
            'performed': res['performed'],
            'nav':       res['nav'],
            'source':    'blinkbot-v4',
        })

    # (2) ON-DEVICE FLOW (primary): the model ran on the client; it posts the parsed
    #     result. Raw text stays on the device — the server only sees actions.
    #     Personality/class requests come in as needs_groq → routed to the cloud model.
    if data.get('needs_groq'):
        try:
            user_context = _assemble_user_context(user_id, session.get('username', ''))
            answer = _call_groq_chat((data.get('message') or '').strip(), [], user_context, user_id)
            return jsonify({'reply': answer, 'source': 'groq', 'needs_groq': True})
        except Exception as e:
            current_app.logger.error(f"BlinkBot groq route error: {e}")
            return jsonify({'reply': data.get('reply') or "Working on it…", 'source': 'blinkbot-v4'}), 200

    if isinstance(data.get('actions'), list):
        res   = _blink_execute(user_id, data['actions'], today=_local_today)
        reply = (data.get('reply') or '').strip() or ('; '.join(res['performed']) if res['performed'] else 'ok')
        return jsonify({
            'reply':           reply,
            'performed':       res['performed'],
            'pending_confirm': res['pending_confirm'],
            'nav':             res['nav'],
            'source':          'blinkbot-v4',
        })

    # (3) SERVER-SIDE FALLBACK: only when a local model is present (dev / self-host).
    #     Production runs the model on-device, so this branch is normally inactive.
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'reply': '', 'source': 'blinkbot-v4'}), 200
    if not (_LOCAL_INFERENCE and _LLAMA_OK and os.path.exists(_BLINK_PATH)):
        return jsonify({'reply': "Run BlinkBot on-device and post its actions.",
                        'source': 'offline'}), 200
    try:
        parsed = _call_blinkbot_translate(message)
    except Exception as e:
        current_app.logger.error(f"BlinkBot translate error: {e}")
        return jsonify({'reply': "BlinkBot hit an error.", 'source': 'error'}), 200
    if not parsed:
        return jsonify({'reply': "Sorry — couldn't read that as a command.",
                        'source': 'blinkbot-v4', 'parse_error': True}), 200
    if parsed.get('needs_groq'):
        try:
            user_context = _assemble_user_context(user_id, session.get('username', ''))
            answer = _call_groq_chat(message, [], user_context, user_id)
            return jsonify({'reply': answer, 'source': 'groq', 'needs_groq': True})
        except Exception as e:
            current_app.logger.error(f"BlinkBot groq route error: {e}")
            return jsonify({'reply': parsed.get('reply') or "Working on it…", 'source': 'blinkbot-v4'}), 200
    res   = _blink_execute(user_id, parsed.get('actions'), today=_local_today)
    reply = parsed.get('reply') or ('; '.join(res['performed']) if res['performed'] else 'ok')
    return jsonify({
        'reply':           reply,
        'performed':       res['performed'],
        'pending_confirm': res['pending_confirm'],
        'nav':             res['nav'],
        'source':          'blinkbot-v4',
    })


# ─────────────────────────────────────────────────────────────────────────────
# BLINKBOT FREEMIUM — download the on-device model, start a free window, then
# charge credits monthly. Subscription state lives in one Note per user
# (entry_type='blinkbot_sub', body = JSON {activated_at, free_until, paid_until}).
# ─────────────────────────────────────────────────────────────────────────────
_BLINK_FREE_DAYS       = int(os.environ.get('BLINKBOT_FREE_DAYS', '150'))   # ~5 months
_BLINK_MONTHLY_CREDITS = int(os.environ.get('BLINKBOT_MONTHLY_CREDITS', '20'))


def _blink_sub_note(user_id):
    """The single Note row holding this user's BlinkBot subscription state, or None."""
    return Note.query.filter_by(user_id=user_id, entry_type='blinkbot_sub',
                                is_deleted=False).first()


def _blink_sub_state(user_id):
    """Current subscription state for the BlinkBot card / gate."""
    n   = _blink_sub_note(user_id)
    now = datetime.utcnow()
    base = {'activated': False, 'expired': False, 'free_until': None,
            'paid_until': None, 'monthly_credits': _BLINK_MONTHLY_CREDITS,
            'free_days': _BLINK_FREE_DAYS}
    if not n or not n.body:
        return base
    try:
        d = json.loads(n.body)
    except Exception:
        return base
    fu = datetime.fromisoformat(d['free_until']) if d.get('free_until') else None
    pu = datetime.fromisoformat(d['paid_until']) if d.get('paid_until') else None
    active = bool((fu and now <= fu) or (pu and now <= pu))
    return {'activated': True, 'expired': not active,
            'free_until': d.get('free_until'), 'paid_until': d.get('paid_until'),
            'monthly_credits': _BLINK_MONTHLY_CREDITS, 'free_days': _BLINK_FREE_DAYS}


def _blink_ensure_activated(user_id):
    """Start the free window if it isn't already running. Idempotent — never resets
    an existing timer. Returns the current state."""
    n = _blink_sub_note(user_id)
    if not (n and n.body):
        now = datetime.utcnow()
        if not n:
            n = Note(user_id=user_id, entry_type='blinkbot_sub')
            db.session.add(n)
        n.body = json.dumps({
            'activated_at': now.isoformat(),
            'free_until':   (now + timedelta(days=_BLINK_FREE_DAYS)).isoformat(),
        })
        db.session.commit()
    return _blink_sub_state(user_id)


@pug_bp.route('/pug/api/blinkbot/status', methods=['GET'])
def blinkbot_status():
    """Subscription state — drives the sidebar card (Download / Ready / Renew)."""
    err = login_required_api()
    if err: return err
    return jsonify(_blink_sub_state(session['user_id']))


@pug_bp.route('/pug/api/blinkbot/activate', methods=['POST'])
@limiter.limit("10 per minute")
def blinkbot_activate():
    """Start the free window. Idempotent — once activated, the timer never resets.
    Called when the user confirms the download in the popup."""
    err = login_required_api()
    if err: return err
    return jsonify(_blink_ensure_activated(session['user_id']))


@pug_bp.route('/pug/api/blinkbot/pay', methods=['POST'])
@limiter.limit("10 per minute")
def blinkbot_pay():
    """Charge one month of credits and extend access by 30 days."""
    err = login_required_api()
    if err: return err
    user_id = session['user_id']
    if not _blink_sub_state(user_id)['expired']:
        return jsonify({'ok': True, **_blink_sub_state(user_id)})   # still in an active window
    w = Wallet.query.filter_by(user_id=user_id).first()
    if not w or w.balance < _BLINK_MONTHLY_CREDITS:
        return jsonify({'error': 'insufficient_credits', 'need': _BLINK_MONTHLY_CREDITS,
                        'have': (w.balance if w else 0)}), 402
    w.balance -= _BLINK_MONTHLY_CREDITS
    n = _blink_sub_note(user_id)
    d = json.loads(n.body) if (n and n.body) else {}
    now  = datetime.utcnow()
    prev = datetime.fromisoformat(d['paid_until']) if d.get('paid_until') else now
    d['paid_until'] = (max(now, prev) + timedelta(days=30)).isoformat()
    n.body = json.dumps(d)
    db.session.add(WalletTx(user_id=user_id, tx_type='spend',
                            amount=-_BLINK_MONTHLY_CREDITS, note='BlinkBot monthly',
                            status='completed'))
    db.session.commit()
    return jsonify({'ok': True, **_blink_sub_state(user_id)})


# The path MUST end in ".gguf" — wllama validates the URL extension before
# downloading and rejects anything else.
@pug_bp.route('/pug/api/blinkbot/model.gguf', methods=['GET'])
def blinkbot_model_file():
    """Serve the GGUF for on-device download. Three modes, in order:
      1. BLINKBOT_MODEL_URL set → redirect (only if it's a PUBLIC url).
      2. BLINKBOT_MODEL_KEY set → stream the object from the (private) storage
         bucket using the app's own credentials. Browser hits us same-origin;
         the private bucket and other users' media stay private.
      3. local file on disk (dev / self-host).
    """
    err = login_required_api()
    if err: return err

    url = os.environ.get('BLINKBOT_MODEL_URL')
    if url:
        # Must be an ABSOLUTE http(s) URL. A bare/relative value would make the
        # browser resolve the redirect against this request path and 404 (e.g.
        # /pug/api/blinkbot/<value>). Ignore it and fall through if it's not.
        if url.startswith(('http://', 'https://')):
            from flask import redirect
            return redirect(url)
        current_app.logger.warning(
            "BLINKBOT_MODEL_URL is not an absolute http(s) URL (%r); "
            "ignoring it and trying BLINKBOT_MODEL_KEY / local file.", url)

    key = os.environ.get('BLINKBOT_MODEL_KEY')
    if key:
        try:
            from flask import Response, stream_with_context
            # Reuse the app's proven storage client/creds (MINIO_* — the very same
            # ones that serve user media from B2 in prod). A parallel n_* config
            # here would default to localhost and 502 wherever only MINIO_* is set.
            bucket = os.environ.get('BLINKBOT_MODEL_BUCKET', MINIO_BUCKET)
            size = minio_client.stat_object(bucket, key).size
            obj  = minio_client.get_object(bucket, key)

            def _stream():
                try:
                    for chunk in obj.stream(256 * 1024):
                        yield chunk
                finally:
                    obj.close(); obj.release_conn()

            resp = Response(stream_with_context(_stream()),
                            mimetype='application/octet-stream')
            resp.headers['Content-Length'] = str(size)   # lets the browser show progress
            resp.headers['Cache-Control']  = 'public, max-age=2592000'
            return resp
        except Exception as e:
            current_app.logger.error(f"BlinkBot model stream error: {e}")
            return jsonify({'error': 'model unavailable'}), 502

    if os.path.exists(_BLINK_PATH):
        from flask import send_file
        return send_file(_BLINK_PATH, mimetype='application/octet-stream',
                         conditional=True, as_attachment=False,
                         download_name='blinkbot_v4.gguf')
    return jsonify({'error': 'model not hosted; set BLINKBOT_MODEL_KEY'}), 404


# ─────────────────────────────────────────────────────────────────────────────
# WHISPER (speech-to-text) — model files for BlinkBot's on-device voice input.
# transformers.js pulls the library + ONNX runtime from jsdelivr (CSP-allowed);
# the model weights stream same-origin through here so the CSP needs no extra
# third-party host. The mic AUDIO is transcribed on-device and never uploaded —
# only the public model weights come down, exactly like the GGUF.
# ─────────────────────────────────────────────────────────────────────────────
_WHISPER_PREFIX = os.environ.get('WHISPER_MODEL_PREFIX', 'whisper')   # bucket key prefix
_WHISPER_DIR    = os.environ.get('WHISPER_MODEL_DIR', os.path.join(_MODELS_DIR, 'whisper'))
_WHISPER_MIME   = {'.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
                   '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream'}


@pug_bp.route('/pug/api/whisper/<path:fname>', methods=['GET'])
def whisper_model_file(fname):
    """Serve one Whisper model file for on-device STT. transformers.js requests
    repo-style subpaths (e.g. 'onnx-community/whisper-tiny.en/onnx/encoder_model_fp16.onnx').
    Streams from the storage bucket in prod (key = WHISPER_MODEL_PREFIX/<fname>),
    falls back to a local dir in dev. Same-origin → stays within the existing CSP."""
    err = login_required_api()
    if err: return err

    # transformers.js only asks for relative repo paths; reject anything else.
    if '..' in fname or fname.startswith('/'):
        return jsonify({'error': 'bad path'}), 400

    import mimetypes
    ext  = os.path.splitext(fname)[1].lower()
    mime = _WHISPER_MIME.get(ext) or mimetypes.guess_type(fname)[0] or 'application/octet-stream'

    # 1) object storage (prod / MinIO dev) — stream with the app's own creds.
    if os.environ.get('n_ENDPOINT'):
        try:
            from minio import Minio
            from flask import Response, stream_with_context
            client = Minio(
                os.environ.get('n_ENDPOINT', 'localhost:9000'),
                access_key=os.environ.get('n_ACCESS_KEY', 'minioadmin'),
                secret_key=os.environ.get('n_SECRET_KEY', 'minioadmin'),
                secure=os.environ.get('n_SECURE', 'false').lower() == 'true',
            )
            bucket = os.environ.get('BLINKBOT_MODEL_BUCKET',
                                    os.environ.get('n_BUCKET', 'veyra-media'))
            key  = f"{_WHISPER_PREFIX}/{fname}"
            size = client.stat_object(bucket, key).size
            obj  = client.get_object(bucket, key)

            def _stream():
                try:
                    for chunk in obj.stream(256 * 1024):
                        yield chunk
                finally:
                    obj.close(); obj.release_conn()

            resp = Response(stream_with_context(_stream()), mimetype=mime)
            resp.headers['Content-Length'] = str(size)
            resp.headers['Cache-Control']  = 'public, max-age=2592000'
            return resp
        except Exception as e:
            current_app.logger.warning(f"Whisper bucket miss ({fname}): {e}; trying local")
            # fall through to the local dir

    # 2) local dir (dev / self-host).
    base  = os.path.abspath(_WHISPER_DIR)
    local = os.path.abspath(os.path.join(base, fname))
    if not local.startswith(base + os.sep):
        return jsonify({'error': 'bad path'}), 400
    if os.path.exists(local):
        from flask import send_file
        return send_file(local, mimetype=mime, conditional=True, max_age=2592000)
    return jsonify({'error': 'whisper model not hosted'}), 404


from collections import deque
# Last N client errors, in memory only (cleared on restart). Lets an admin read
# them at /pug/api/clientlog/recent without digging through Render's log stream.
_CLIENT_LOG = deque(maxlen=80)


@pug_bp.route('/pug/api/clientlog', methods=['POST'])
@limiter.limit("30 per minute")
def client_log():
    """Receive a client-side JS error for debugging from real user devices.
    Deliberately minimal: logs to the app logger (→ Render logs) + a small
    in-memory ring buffer, persists NOTHING to the DB, and keeps no user content
    — only the error text, where it happened, the stack, the browser, and the
    page path. No query strings, no PII stored."""
    from datetime import datetime, timezone
    data = request.get_json(silent=True) or {}

    def _clip(v, n):
        return str(v)[:n] if v is not None else ''

    msg = _clip(data.get('message'), 500)
    if not msg:
        return ('', 204)
    entry = {
        'ts':    datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'msg':   msg,
        'src':   _clip(data.get('source'), 300),   # 'file:line:col' or 'tag:blinkbot:load'
        'page':  _clip(data.get('page'),   200),   # path only (client strips the query)
        'stack': _clip(data.get('stack'),  2000),
        'ua':    _clip(request.headers.get('User-Agent'), 300),
    }
    _CLIENT_LOG.appendleft(entry)
    current_app.logger.warning("[clientlog] %s | at=%s | page=%s | ua=%s\n%s",
                               entry['msg'], entry['src'], entry['page'], entry['ua'], entry['stack'])
    return ('', 204)


@pug_bp.route('/pug/api/clientlog/recent', methods=['GET'])
def client_log_recent():
    """Admin-only: the most recent client errors from the in-memory buffer.
    Visit while logged in as an admin to read what users' devices reported."""
    err = admin_required_api()
    if err:
        return err
    return jsonify({'count': len(_CLIENT_LOG), 'errors': list(_CLIENT_LOG)})


@pug_bp.route('/pug/api/buddybot', methods=['POST'])
def buddybot_endpoint():
    """BuddyBot chat endpoint."""
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


@pug_bp.route('/pug/api/quickask', methods=['POST'])
@limiter.limit("15 per minute")
def quick_ask():
    """Quick Ask — the home chat card. Sends the message to the Groq cloud model
    along with the user's context and returns the reply."""
    err = login_required_api()
    if err: return err

    user_id = session['user_id']
    data    = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'reply': ''}), 200
    if len(message) > 2000:
        return jsonify({'reply': "That's a bit long — trim it down and try again.",
                        'source': 'error'}), 200

    history = data.get('history') if isinstance(data.get('history'), list) else []
    try:
        user_context = _assemble_user_context(user_id, session.get('username', ''))
        answer = _call_groq_chat(message, history, user_context, user_id)
    except Exception as e:
        current_app.logger.error(f"Quick Ask error: {e}")
        answer = None

    if not answer:
        return jsonify({'reply': "Quick Ask is unavailable right now — try again in a moment.",
                        'source': 'unavailable'}), 200
    return jsonify({'reply': answer, 'source': 'groq'})


# ═════════════════════════════════════════════════════════════════════════════
# SKILLS, STATS & RANKS  (the skill-ranking identity system)
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/stats', methods=['GET'])
@limiter.limit("10 per minute")
def get_stats_sheet():
    """Return the user's AI-generated stat sheet (class, personality, skills, ranks)."""
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

    def _ai_to_suggestions(ai_sheet, keep_skills):
        """Convert AI-generated skills into suggestions, preserving confirmed user skills."""
        confirmed = {s.get('name') for s in keep_skills}
        suggestions = [
            {'name': s['name'], 'class_id': s.get('class_id', ''), 'class_label': s.get('class_label', '')}
            for s in (ai_sheet.pop('skills', None) or [])
            if s.get('name') and s['name'] not in confirmed
        ]
        ai_sheet['suggestions'] = suggestions
        return ai_sheet

    if cache_only:
        # Page-load silent fetch: only return what's already stored, never generate
        sheet = db_sheet
    elif refresh:
        # Forced refresh — regenerate personality/class/bio/suggestions; preserve confirmed skills
        old_sheet    = db_sheet or {}
        user_context = _assemble_user_context(user_id, session.get('username', ''))
        new_sheet    = _generate_character_sheet(user_id, user_context, notes_count, streak)
        if new_sheet:
            new_sheet['skills'] = old_sheet.get('skills', [])
            _ai_to_suggestions(new_sheet, new_sheet['skills'])
            sheet = new_sheet
            _save_cached_sheet(user_id, sheet)
        else:
            sheet = db_sheet
    elif db_sheet:
        # Cache exists — return it regardless of age; midnight refresh handles updates
        sheet = db_sheet
    else:
        # No cache at all (first use) — generate once
        user_context = _assemble_user_context(user_id, session.get('username', ''))
        new_sheet    = _generate_character_sheet(user_id, user_context, notes_count, streak)
        if new_sheet:
            new_sheet['skills'] = []
            _ai_to_suggestions(new_sheet, [])
            sheet = new_sheet
            _save_cached_sheet(user_id, sheet)

    return jsonify({
        'notes_count': notes_count,
        'streak':      streak,
        'media_count': media_count,
        'sheet':       sheet,
    })


@pug_bp.route('/pug/api/stats/skill-class', methods=['PATCH'])
def update_skill_class():
    """Change a skill's class/category."""
    err = login_required_api()
    if err: return err
    user_id = session.get('user_id')
    data        = request.get_json(force=True) or {}
    skill_name  = (data.get('name') or '').strip()
    class_id    = (data.get('class_id') or '').strip()
    class_label = (data.get('class_label') or '').strip()
    if not skill_name:
        return jsonify({'error': 'name required'}), 400
    sheet  = _get_cached_sheet(user_id) or {}
    skills = sheet.get('skills', [])
    for s in skills:
        if s.get('name') == skill_name:
            s['class_id']    = class_id
            s['class_label'] = class_label
            break
    sheet['skills'] = skills
    _save_cached_sheet(user_id, sheet)
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/stats/skill', methods=['POST'])
def add_skill_manual():
    """Add a skill to the stat sheet manually."""
    err = login_required_api()
    if err: return err
    user_id = session.get('user_id')
    data        = request.get_json(force=True) or {}
    name        = (data.get('name') or '').strip()
    class_id    = (data.get('class_id') or '').strip()
    class_label = (data.get('class_label') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    sheet  = _get_cached_sheet(user_id) or {}
    skills = sheet.get('skills', [])
    if not any(s.get('name') == name and s.get('class_id') == class_id for s in skills):
        skills.append({
            'name': name, 'rank': 'E-', 'verified': False,
            'context': '', 'note': 'Add proof in Achievements to unlock a real rank.',
            'class_id': class_id, 'class_label': class_label, 'exp': 0,
            'user_added': True,
        })
        sheet['skills'] = skills
        # Remove from suggestions once confirmed
        sheet['suggestions'] = [s for s in sheet.get('suggestions', []) if s.get('name') != name]
        _save_cached_sheet(user_id, sheet)
        _ensure_skill_habits(user_id, [{'name': name}])
    return jsonify({'ok': True, 'sheet': sheet})


@pug_bp.route('/pug/api/stats/skill', methods=['DELETE'])
def remove_skill():
    """Remove a skill from the stat sheet."""
    err = login_required_api()
    if err: return err
    user_id  = session.get('user_id')
    data     = request.get_json(force=True) or {}
    name     = (data.get('name') or '').strip()
    class_id = (data.get('class_id') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    sheet = _get_cached_sheet(user_id) or {}
    sheet['skills'] = [
        s for s in sheet.get('skills', [])
        if not (s.get('name') == name and s.get('class_id', '') == class_id)
    ]
    _save_cached_sheet(user_id, sheet)
    return jsonify({'ok': True, 'sheet': sheet})


@pug_bp.route('/pug/api/stats/skill-suggestion/dismiss', methods=['POST'])
def dismiss_suggestion():
    """Dismiss an AI-suggested skill so it stops being offered."""
    err = login_required_api()
    if err: return err
    user_id = session.get('user_id')
    data    = request.get_json(force=True) or {}
    name    = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    sheet = _get_cached_sheet(user_id) or {}
    sheet['suggestions'] = [s for s in sheet.get('suggestions', []) if s.get('name') != name]
    _save_cached_sheet(user_id, sheet)
    return jsonify({'ok': True, 'sheet': sheet})


# ── EXP award ────────────────────────────────────────────────────────────────
import os as _os

def _load_exp_config():
    path = _os.path.join(_os.path.dirname(__file__), '..', 'static', 'exp_config.json')
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}

_EXP_CONFIG = None

def _get_exp_config():
    global _EXP_CONFIG
    if _EXP_CONFIG is None:
        _EXP_CONFIG = _load_exp_config()
    return _EXP_CONFIG

def _exp_rank(total_exp):
    cfg = _get_exp_config()
    th  = cfg.get('rank_thresholds', {})
    rank_order = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F']
    for r in rank_order:
        if th.get(r) is not None and total_exp >= th[r]:
            return r
    return 'F'

def _post_skill_tag(post):
    """Extract the skill tag from a community post Note, or None."""
    body = post.body or ''
    if body.startswith('{'):
        try:
            return json.loads(body).get('sk') or None
        except Exception:
            pass
    return None


def award_exp(user_id, skill_name, action, count=1):
    """Award EXP to a named skill for a community action. Returns updated exp total."""
    cfg     = _get_exp_config()
    weight  = cfg.get('action_weights', {}).get(action, 0)
    delta   = weight * count
    if delta <= 0:
        return None
    sheet  = _get_cached_sheet(user_id) or {}
    skills = sheet.get('skills', [])
    for s in skills:
        if s.get('name') == skill_name:
            s['exp'] = round(s.get('exp', 0) + delta, 2)
            s['rank'] = _exp_rank(s['exp'])
            break
    sheet['skills'] = skills
    _save_cached_sheet(user_id, sheet)
    return sheet


@pug_bp.route('/pug/api/stats/skill/exp', methods=['POST'])
def add_skill_exp():
    """Award EXP to a skill for a given action. Body: {skill, action, count?}"""
    err = login_required_api()
    if err: return err
    user_id = session.get('user_id')
    data    = request.get_json(force=True) or {}
    skill   = (data.get('skill') or '').strip()
    action  = (data.get('action') or '').strip()
    count   = int(data.get('count', 1))
    if not skill or not action:
        return jsonify({'error': 'skill and action required'}), 400
    cfg = _get_exp_config()
    if action not in cfg.get('action_weights', {}):
        return jsonify({'error': f'unknown action: {action}'}), 400
    sheet = award_exp(user_id, skill, action, count)
    if sheet is None:
        return jsonify({'error': 'skill not found in your sheet'}), 404
    return jsonify({'ok': True, 'sheet': sheet})



# ═════════════════════════════════════════════════════════════════════════════
# PROFILE MANAGEMENT — username / password / delete account
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/profile/username', methods=['PATCH'])
def update_username():
    """Change the user's username."""
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
    """Change the user's password."""
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
    """Delete the user's account and all their data."""
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

_RANK_ORDER = ['S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E','F']

def _net_rank_from_sheet(sheet):
    """Best verified rank in a parsed stats-cache sheet → (rank_str, color)."""
    skills = sheet.get('skills', [])
    for r in _RANK_ORDER:
        if any(s.get('rank','').upper() == r and s.get('verified', True) for s in skills):
            return r, _RANK_COLORS.get(r, '#888')
    return None, None


def _net_rank_for_user(uid):
    """Return (rank_str, color) from that user's stats cache, or (None, None)."""
    n = Note.query.filter_by(user_id=uid, entry_type='stats_cache', is_deleted=False).first()
    if not n or not n.body:
        return None, None
    try:
        return _net_rank_from_sheet(json.loads(n.body))
    except Exception:
        return None, None


def _skills_match(skills, skill_name):
    """True if any verified skill in the list contains skill_name (case-insensitive)."""
    return any(
        s.get('verified', False) and skill_name in (s.get('name') or '').lower()
        for s in skills
    )


def _feed_user_meta(uids, with_location=False):
    """Batch the per-author lookups the feed needs — User row, net rank, skill
    list, location — as one query per table instead of one per post. Each
    stats-cache sheet is decrypted and parsed exactly once."""
    from shared.auth.user import User
    meta = {}
    uids = list(set(uids))
    if not uids:
        return meta
    for u in User.query.filter(User.id.in_(uids)).all():
        meta[u.id] = {'user': u, 'rank': (None, None), 'skills': [], 'loc': (None, None)}
    caches = Note.query.filter(
        Note.user_id.in_(uids), Note.entry_type == 'stats_cache', Note.is_deleted == False
    ).all()
    for n in caches:
        m = meta.get(n.user_id)
        if not m or not n.body:
            continue
        try:
            sheet = json.loads(n.body)
        except Exception:
            continue
        m['rank']   = _net_rank_from_sheet(sheet)
        m['skills'] = sheet.get('skills', [])
    if with_location:
        locs = Note.query.filter(
            Note.user_id.in_(uids), Note.entry_type == 'user_location', Note.is_deleted == False
        ).all()
        for n in locs:
            m = meta.get(n.user_id)
            if not m or not n.body:
                continue
            try:
                d = json.loads(n.body)
                m['loc'] = (float(d['lat']), float(d['lng']))
            except Exception:
                pass
    return meta


def _haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


def _is_online(u):
    if not u or not u.last_seen:
        return False
    return (datetime.utcnow() - u.last_seen).total_seconds() < 300

def _connection_count(uid):
    from sqlalchemy import distinct as _distinct
    sent = db.session.query(_distinct(Note.mood)).filter(
        Note.user_id == uid, Note.entry_type == 'dm', Note.is_deleted == False
    ).all()
    recv = db.session.query(_distinct(Note.user_id)).filter(
        Note.mood == str(uid), Note.entry_type == 'dm', Note.is_deleted == False
    ).all()
    ids = set()
    for r in sent:
        if r[0] and str(r[0]).lstrip('-').isdigit():
            ids.add(int(r[0]))
    for r in recv:
        ids.add(r[0])
    return len(ids)


# Distinct reports that auto-quarantine a post from the feed pending admin review.
_REPORT_HIDE_THRESHOLD = 3


def _blocked_ids(me):
    """User ids hidden from `me` in either direction (I blocked them, or they blocked me)."""
    from sqlalchemy import or_
    rows = UserBlock.query.filter(or_(UserBlock.blocker_id == me, UserBlock.blocked_id == me)).all()
    return {(r.blocked_id if r.blocker_id == me else r.blocker_id) for r in rows}


def _svg_global_rows(me, blocked):
    """Cross-distro feed: svg's shared (is_global) posts, normalised into the pug feed shape.

    svg keeps its own store (community_posts); we read it directly since it's the same DB.
    svg uses a single up-vote instead of like/dislike, so we map vote_count → 'likes' and the
    caller's vote → my_reaction='like'. Each row carries source='svg' so the frontend routes
    interactions back to svg's endpoints.
    """
    from distro.svg.models.community import CommunityPost, PostVote, PostComment
    from sqlalchemy import func as sqlfunc
    q = CommunityPost.query.filter(CommunityPost.is_global.is_(True))
    if blocked:
        q = q.filter(~CommunityPost.user_id.in_(blocked))
    sposts = q.order_by(CommunityPost.created_at.desc()).limit(100).all()
    if not sposts:
        return []
    ids        = [p.id for p in sposts]
    my_votes   = {v.post_id for v in PostVote.query.filter(
                     PostVote.user_id == me, PostVote.post_id.in_(ids)).all()}
    comment_ct = dict(db.session.query(PostComment.post_id, sqlfunc.count(PostComment.id))
                        .filter(PostComment.post_id.in_(ids))
                        .group_by(PostComment.post_id).all())
    rows = []
    for p in sposts:
        author = p.author
        body   = (f'{p.title}\n\n{p.body}' if p.title else p.body) or ''
        rows.append({
            'id':          p.id,
            'source':      'svg',
            'is_global':   True,
            'text':        body,
            'media_key':   None,
            'media_url':   p.image_url,
            'post_type':   None,
            'pinned_cid':  None,
            'text_order':  'tm',
            'skill_tag':   (p.tag if p.tag and p.tag != 'general' else None),
            'username':    author.username if author else '?',
            'user_id':     p.user_id,
            'distro':      p.distro or 'Eco-Svg',
            'rank':        None,
            'rank_color':  None,
            'is_mine':     p.user_id == me,
            'is_online':   False,
            'created_at':  p.created_at.isoformat() if p.created_at else None,
            'dist_km':     None,
            'likes':       p.vote_count or 0,
            'dislikes':    0,
            'my_reaction': 'like' if p.id in my_votes else None,
            'comment_count': comment_ct.get(p.id, 0),
        })
    return rows



# ═════════════════════════════════════════════════════════════════════════════
# COMMUNITY FEED — posts, comments, reactions, ShowOff actions
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/community', methods=['GET'])
def get_community_feed():
    """Return the community feed (filtered by location/skill; hidden + blocked excluded)."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    am_admin = _is_admin(me)        # show owner-style delete on every post if admin
    blocked = _blocked_ids(me)

    # Optional location filter
    try:
        my_lat = float(request.args['lat'])
        my_lng = float(request.args['lng'])
        use_location = True
    except (KeyError, ValueError):
        use_location = False

    skill_filter = (request.args.get('skill') or '').strip().lower()
    user_filter  = request.args.get('user_id', type=int)
    # 'mine' = only this distro's posts (default); 'all' = merge in other distros' shared posts.
    distro_scope = (request.args.get('distro_scope') or 'mine').strip().lower()

    q = Note.query.filter(Note.entry_type == 'community_post', Note.is_deleted == False,
                          Note.is_hidden.isnot(True), Note.mood.in_(['Ocellus', 'ThePug']))
    if user_filter:
        q = q.filter_by(user_id=user_filter)
    if blocked:
        q = q.filter(~Note.user_id.in_(blocked))
    posts = q.order_by(Note.created_at.desc()).limit(200).all()

    # All per-author data in 3 batched queries (users, stats caches, locations)
    meta = _feed_user_meta([p.user_id for p in posts],
                           with_location=use_location and not user_filter)

    def _build_row(p, m, dist_km=None):
        u = m['user']
        rank, color = m['rank']
        body = p.body or ''
        text, media_key, post_type, pinned_cid, text_order, skill_tag = body, None, None, None, 'tm', None
        is_global_post = False
        if body.startswith('{'):
            try:
                bd = json.loads(body)
                text       = bd.get('t', '')
                media_key  = bd.get('m')
                post_type  = bd.get('pt')
                pinned_cid = bd.get('pin')
                text_order = bd.get('to', 'tm')
                skill_tag  = bd.get('sk')
                is_global_post = bool(bd.get('g'))   # shared into the all-distros feed?
            except Exception:
                pass
        media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
        return {
            'id':          p.id,
            'source':      'pug',          # which store this post lives in (for routing interactions)
            'is_global':   is_global_post,
            'text':        text,
            'media_key':   media_key,
            'media_url':   media_url,
            'post_type':   post_type,
            'pinned_cid':  pinned_cid,
            'text_order':  text_order,
            'skill_tag':   skill_tag,
            'username':    u.username,
            'user_id':     p.user_id,
            'distro':      p.mood or 'Ocellus',
            'rank':        rank,
            'rank_color':  color,
            'is_mine':     p.user_id == me,
            'can_moderate': am_admin,      # admin: same delete access on any post as its owner
            'is_online':   _is_online(u),
            'created_at':  p.created_at.isoformat() if p.created_at else None,
            'dist_km':     round(dist_km, 1) if dist_km is not None else None,
        }

    def _enrich(posts_list):
        if not posts_list:
            return posts_list
        from sqlalchemy import func as sqlfunc
        pids = [str(r['id']) for r in posts_list]
        reacts = Note.query.filter(
            Note.entry_type == 'post_react',
            Note.mood.in_(pids),
            Note.is_deleted == False
        ).all()
        rm = {}
        for r in reacts:
            rm.setdefault(r.mood, {'likes': 0, 'dislikes': 0, 'my_reaction': None})
            if r.is_finished:
                rm[r.mood]['likes'] += 1
            else:
                rm[r.mood]['dislikes'] += 1
            if r.user_id == me:
                rm[r.mood]['my_reaction'] = 'like' if r.is_finished else 'dislike'
        cc = db.session.query(Note.mood, sqlfunc.count(Note.id)).filter(
            Note.entry_type == 'post_comment',
            Note.mood.in_(pids),
            Note.is_deleted == False
        ).group_by(Note.mood).all()
        cmap = {pid_s: cnt for pid_s, cnt in cc}
        for row in posts_list:
            d = rm.get(str(row['id']), {})
            row['likes']         = d.get('likes', 0)
            row['dislikes']      = d.get('dislikes', 0)
            row['my_reaction']   = d.get('my_reaction')
            row['comment_count'] = cmap.get(str(row['id']), 0)
        return posts_list

    if use_location and not user_filter:
        for radius_km in (50, 100, 250, None):
            result = []
            for p in posts:
                m = meta.get(p.user_id)
                if not m: continue
                plat, plng = m['loc']
                dist = _haversine_km(my_lat, my_lng, plat, plng) if plat is not None else None
                if radius_km is not None:
                    if dist is None or dist > radius_km:
                        continue
                if skill_filter and not _skills_match(m['skills'], skill_filter):
                    continue
                result.append(_build_row(p, m, dist_km=dist))
            if len(result) >= 5 or radius_km is None:
                return jsonify({'posts': _enrich(result), 'radius_km': radius_km})
        return jsonify({'posts': [], 'radius_km': None})

    result = []
    for p in posts:
        m = meta.get(p.user_id)
        if not m: continue
        if skill_filter and not _skills_match(m['skills'], skill_filter):
            continue
        result.append(_build_row(p, m))
    result = _enrich(result)
    # All-distros view: merge in other distros' shared posts (svg today; div has none yet).
    if distro_scope == 'all' and not user_filter:
        result = result + _svg_global_rows(me, blocked)
        result.sort(key=lambda r: r.get('created_at') or '', reverse=True)
    return jsonify({'posts': result, 'radius_km': None})


@pug_bp.route('/pug/api/community/version', methods=['GET'])
def community_version():
    """Cheap change marker for the feed. Every community mutation (post, comment,
    react toggle, pin, delete, type change) touches Note.updated_at via onupdate,
    so MAX(updated_at) changes iff something changed. Clients poll this and only
    re-fetch the feed when the value differs."""
    err = login_required_api()
    if err: return err
    from sqlalchemy import func as sqlfunc
    v = db.session.query(sqlfunc.max(Note.updated_at)).filter(
        Note.entry_type.in_(['community_post', 'post_comment', 'post_react', 'comment_react'])
    ).scalar()
    return jsonify({'v': v.isoformat() if v else ''})


@pug_bp.route('/pug/api/community', methods=['POST'])
@limiter.limit("5 per hour; 1 per minute")
def create_community_post():
    """Create a community post."""
    err = login_required_api()
    if err: return err
    err = _muted_block()
    if err: return err
    data      = request.get_json(force=True) or {}
    text      = (data.get('text') or '').strip()
    media_key = (data.get('media_key') or '').strip()
    post_type = (data.get('post_type') or '').strip().lower()
    VALID_TYPES = {'blog', 'showoff', 'buy', 'hire', 'learn', 'collab', 'sell', 'teach'}
    if post_type and post_type not in VALID_TYPES:
        post_type = ''
    if not text and not media_key:
        return jsonify({'error': 'Empty post'}), 400
    if len(text) > 500:
        return jsonify({'error': 'Too long (max 500 chars)'}), 400
    if media_key and not media_key.startswith('shared/'):
        return jsonify({'error': 'Invalid media key'}), 400
    # duplicate guard: same text posted by this user in the last 10 minutes
    if text:
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(minutes=10)
        dup = Note.query.filter(
            Note.user_id    == session['user_id'],
            Note.entry_type == 'community_post',
            Note.is_deleted == False,
            Note.created_at >= cutoff
        ).all()
        for d in dup:
            b = d.body or ''
            existing_text = b
            if b.startswith('{'):
                try: existing_text = json.loads(b).get('t', '')
                except Exception: pass
            if existing_text.strip() == text:
                return jsonify({'error': 'You already posted this recently.'}), 429
    text_order = (data.get('text_order') or '').strip() or None
    if text_order not in (None, 'tm', 'mt'):
        text_order = None
    skill_tag = (data.get('skill_tag') or '').strip() or None
    # Cross-distro visibility: 'g' (global) = also surface this post in the all-distros feed.
    all_distros = bool(data.get('all_distros'))
    if media_key or post_type or text_order or skill_tag or all_distros:
        body_val = json.dumps({k: v for k, v in {'t': text, 'm': media_key or None, 'pt': post_type or None, 'to': text_order, 'sk': skill_tag, 'g': all_distros or None}.items() if v})
    else:
        body_val = text
    p = Note(
        user_id    = session['user_id'],
        entry_type = 'community_post',
        is_deleted = False,
        is_finished= False,
    )
    p.body = body_val
    p.mood = session.get('distro', 'Ocellus')
    db.session.add(p)
    db.session.commit()
    return jsonify({'id': p.id, 'ok': True}), 201


@pug_bp.route('/pug/api/community/<int:pid>', methods=['GET'])
def get_community_post(pid):
    """Return a single community post (404 if hidden/blocked)."""
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    me = session['user_id']
    p = Note.query.filter(Note.id == pid, Note.entry_type == 'community_post', Note.is_deleted == False, Note.mood.in_(['Ocellus', 'ThePug'])).first()
    if not p:
        return jsonify({'error': 'Not found'}), 404
    # Hidden (auto-quarantined / admin-removed) posts are invisible to everyone but their author.
    if p.is_hidden and p.user_id != me:
        return jsonify({'error': 'Not found'}), 404
    if p.user_id in _blocked_ids(me):
        return jsonify({'error': 'Not found'}), 404
    u = User.query.get(p.user_id)
    if not u:
        return jsonify({'error': 'Not found'}), 404

    rank, color = _net_rank_for_user(p.user_id)
    body = p.body or ''
    text, media_key, post_type, pinned_cid, text_order, skill_tag = body, None, None, None, 'tm', None
    if body.startswith('{'):
        try:
            bd = json.loads(body)
            text       = bd.get('t', '')
            media_key  = bd.get('m')
            post_type  = bd.get('pt')
            pinned_cid = bd.get('pin')
            text_order = bd.get('to', 'tm')
            skill_tag  = bd.get('sk')
        except Exception:
            pass
    media_url = url_for('pug.serve_media_shared', object_name=media_key) if media_key else None
    row = {
        'id':          p.id,
        'text':        text,
        'media_key':   media_key,
        'media_url':   media_url,
        'post_type':   post_type,
        'pinned_cid':  pinned_cid,
        'text_order':  text_order,
        'skill_tag':   skill_tag,
        'username':    u.username,
        'user_id':     p.user_id,
        'distro':      p.mood or 'Ocellus',
        'rank':        rank,
        'rank_color':  color,
        'is_mine':     p.user_id == me,
        'is_online':   _is_online(u),
        'created_at':  p.created_at.isoformat() if p.created_at else None,
    }
    # enrich with reactions + comment count
    pids = [str(p.id)]
    reacts = Note.query.filter(
        Note.entry_type == 'post_react',
        Note.mood.in_(pids),
        Note.is_deleted == False
    ).all()
    likes = dislikes = 0
    my_reaction = None
    for r in reacts:
        if r.is_finished: likes += 1
        else: dislikes += 1
        if r.user_id == me:
            my_reaction = 'like' if r.is_finished else 'dislike'
    cc = Note.query.filter_by(entry_type='post_comment', mood=str(p.id), is_deleted=False).count()
    row['likes'] = likes
    row['dislikes'] = dislikes
    row['my_reaction'] = my_reaction
    row['comment_count'] = cc
    return jsonify(row)


@pug_bp.route('/pug/api/community/<int:pid>', methods=['DELETE'])
def delete_community_post(pid):
    """Delete a community post — the caller's own, or any post if the caller is an admin."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    p = Note.query.filter_by(id=pid, entry_type='community_post').first()
    if not p:
        return jsonify({'error': 'Not found'}), 404
    if p.user_id != me and not _is_admin(me):
        return jsonify({'error': 'Forbidden'}), 403
    # Hard delete — wipe the post and everything keyed off it (reactions + comments
    # are Notes with mood=post id) so nothing lingers in the DB.
    pid_s = str(p.id)
    Note.query.filter(
        Note.entry_type.in_(['post_react', 'post_comment']),
        Note.mood == pid_s
    ).delete(synchronize_session=False)
    db.session.delete(p)
    db.session.commit()
    return jsonify({'ok': True})


# ── Moderation: report posts, block users, admin review queue ──────────────────
@pug_bp.route('/pug/api/community/<int:pid>/report', methods=['POST'])
@limiter.limit("20 per hour")
def report_post(pid):
    """Report a community post; auto-hides it once it passes the report threshold."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    p = Note.query.filter(Note.id == pid, Note.entry_type == 'community_post',
                          Note.is_deleted == False).first()
    if not p:
        return jsonify({'error': 'Post not found'}), 404
    if p.user_id == me:
        return jsonify({'error': "You can't report your own post."}), 400
    reason = ((request.get_json(silent=True) or {}).get('reason') or '').strip()[:300]
    if PostReport.query.filter_by(post_id=pid, reporter_id=me).first():
        return jsonify({'ok': True, 'already': True})
    db.session.add(PostReport(post_id=pid, reporter_id=me, reason=reason))
    try:
        db.session.flush()
    except Exception:
        db.session.rollback()  # raced on the unique constraint — already reported
        return jsonify({'ok': True, 'already': True})
    p.report_count = PostReport.query.filter_by(post_id=pid).count()
    if (p.report_count or 0) >= _REPORT_HIDE_THRESHOLD:
        p.is_hidden = True
    _protect_reporter(me, p.user_id)
    db.session.commit()
    return jsonify({'ok': True, 'hidden': bool(p.is_hidden)})


@pug_bp.route('/pug/api/users/<int:uid>/block', methods=['POST'])
@limiter.limit("60 per hour")
def block_user(uid):
    """Block another user (hide their posts, prevent DMs both ways)."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    if uid == me:
        return jsonify({'error': "You can't block yourself."}), 400
    from shared.auth.user import User
    if not db.session.get(User, uid):
        return jsonify({'error': 'User not found'}), 404
    if not UserBlock.query.filter_by(blocker_id=me, blocked_id=uid).first():
        db.session.add(UserBlock(blocker_id=me, blocked_id=uid))
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
    return jsonify({'ok': True, 'blocked': True})


@pug_bp.route('/pug/api/users/<int:uid>/block', methods=['DELETE'])
def unblock_user(uid):
    """Unblock a previously-blocked user."""
    err = login_required_api()
    if err: return err
    UserBlock.query.filter_by(blocker_id=session['user_id'], blocked_id=uid).delete()
    db.session.commit()
    return jsonify({'ok': True, 'blocked': False})


@pug_bp.route('/pug/api/admin/reports', methods=['GET'])
def admin_reports_list():
    """Admin: list reported posts pending review."""
    err = admin_required_api()
    if err: return err
    from shared.auth.user import User
    posts = (Note.query
             .filter(Note.entry_type == 'community_post', Note.is_deleted == False,
                     Note.report_count > 0)
             .order_by(Note.is_hidden.desc(), Note.report_count.desc(), Note.created_at.desc())
             .limit(100).all())
    out = []
    for p in posts:
        author = db.session.get(User, p.user_id)
        body = p.body or ''
        text = body
        if body.startswith('{'):
            try: text = (json.loads(body).get('t') or '')
            except Exception: pass
        reports = PostReport.query.filter_by(post_id=p.id).order_by(PostReport.created_at.desc()).all()
        out.append({
            'id':           p.id,
            'text':         text[:280],
            'author':       author.username if author else str(p.user_id),
            'author_id':    p.user_id,
            'report_count': p.report_count or 0,
            'is_hidden':    bool(p.is_hidden),
            'created_at':   p.created_at.isoformat() if p.created_at else None,
            'reasons':      [r.reason for r in reports if r.reason],
        })
    return jsonify(out)


@pug_bp.route('/pug/api/admin/reports/<int:pid>/<action>', methods=['POST'])
def admin_report_action(pid, action):
    """Admin: act on a reported post (remove or keep)."""
    err = admin_required_api()
    if err: return err
    p = Note.query.filter_by(id=pid, entry_type='community_post').first()
    if not p:
        return jsonify({'error': 'Post not found'}), 404
    if action == 'remove':          # confirmed violation — delete from the feed
        p.is_deleted = True
        p.is_hidden  = True
    elif action == 'keep':          # cleared — restore and reset the report tally
        p.is_hidden = False
        p.report_count = 0
        PostReport.query.filter_by(post_id=pid).delete()
    else:
        return jsonify({'error': 'Unknown action'}), 400
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/community/<int:pid>/react', methods=['POST'])
def react_post(pid):
    """Add/toggle a like or dislike on a post."""
    err = login_required_api()
    if err: return err
    me   = session['user_id']
    data = request.get_json(force=True) or {}
    rtype = (data.get('type') or '').strip()
    if rtype not in ('like', 'dislike'):
        return jsonify({'error': 'Invalid'}), 400
    existing = Note.query.filter_by(
        user_id=me, entry_type='post_react', mood=str(pid), is_deleted=False
    ).first()
    if existing:
        if (existing.is_finished and rtype == 'like') or (not existing.is_finished and rtype == 'dislike'):
            existing.is_deleted = True
        else:
            existing.is_finished = (rtype == 'like')
    else:
        n = Note(user_id=me, entry_type='post_react', is_deleted=False,
                 mood=str(pid), is_finished=(rtype == 'like'))
        db.session.add(n)
        # award EXP to post author on a new like (not on toggle/remove)
        if rtype == 'like':
            post = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
            if post and post.user_id != me:
                sk = _post_skill_tag(post)
                if sk:
                    award_exp(post.user_id, sk, 'like')
    db.session.commit()
    rows = Note.query.filter_by(entry_type='post_react', mood=str(pid), is_deleted=False).all()
    likes    = sum(1 for r in rows if r.is_finished)
    dislikes = sum(1 for r in rows if not r.is_finished)
    my_row   = next((r for r in rows if r.user_id == me), None)
    my_react = ('like' if my_row.is_finished else 'dislike') if my_row else None
    return jsonify({'likes': likes, 'dislikes': dislikes, 'my_reaction': my_react})


@pug_bp.route('/pug/api/community/<int:pid>/comment/<int:cid>/react', methods=['POST'])
def react_comment(pid, cid):
    """Add/toggle a reaction on a comment."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    data = request.get_json(silent=True) or {}
    rtype = (data.get('type') or '').strip()
    if rtype not in ('like', 'dislike'):
        return jsonify({'error': 'Invalid'}), 400
    existing = Note.query.filter_by(
        user_id=me, entry_type='comment_react', mood=str(cid), is_deleted=False
    ).first()
    if existing:
        if (existing.is_finished and rtype == 'like') or (not existing.is_finished and rtype == 'dislike'):
            existing.is_deleted = True
        else:
            existing.is_finished = (rtype == 'like')
    else:
        n = Note(user_id=me, entry_type='comment_react', is_deleted=False,
                 mood=str(cid), is_finished=(rtype == 'like'))
        db.session.add(n)
    db.session.commit()
    rows = Note.query.filter_by(entry_type='comment_react', mood=str(cid), is_deleted=False).all()
    likes    = sum(1 for r in rows if r.is_finished)
    dislikes = sum(1 for r in rows if not r.is_finished)
    my_row   = next((r for r in rows if r.user_id == me), None)
    my_react = ('like' if my_row.is_finished else 'dislike') if my_row else None
    return jsonify({'likes': likes, 'dislikes': dislikes, 'my_reaction': my_react})


@pug_bp.route('/pug/api/community/<int:pid>/comments', methods=['GET'])
def get_post_comments(pid):
    """List a post's comments."""
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    me = session['user_id']
    parent = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
    pinned_cid = None
    post_author = None
    if parent:
        post_author = parent.user_id
        body = parent.body or ''
        if body.startswith('{'):
            try: pinned_cid = json.loads(body).get('pin')
            except Exception: pass
    comments = Note.query.filter_by(
        entry_type='post_comment', mood=str(pid), is_deleted=False
    ).order_by(Note.created_at.asc()).limit(50).all()
    umap = {u.id: u for u in User.query.filter(User.id.in_({c.user_id for c in comments})).all()} if comments else {}
    comment_ids = [c.id for c in comments]
    creact_rows = Note.query.filter(
        Note.entry_type == 'comment_react',
        Note.mood.in_([str(i) for i in comment_ids]),
        Note.is_deleted == False
    ).all() if comment_ids else []
    c_likes, c_dislikes, c_mine = {}, {}, {}
    for r in creact_rows:
        cid = int(r.mood)
        if r.is_finished:
            c_likes[cid] = c_likes.get(cid, 0) + 1
        else:
            c_dislikes[cid] = c_dislikes.get(cid, 0) + 1
        if r.user_id == me:
            c_mine[cid] = 'like' if r.is_finished else 'dislike'
    result = []
    for c in comments:
        u = umap.get(c.user_id)
        if not u: continue
        result.append({
            'id':          c.id,
            'user_id':     c.user_id,
            'username':    u.username,
            'text':        c.body,
            'created_at':  c.created_at.isoformat() if c.created_at else None,
            'is_mine':     c.user_id == me,
            'is_pinned':   c.id == pinned_cid,
            'can_pin':     post_author == me,
            'likes':       c_likes.get(c.id, 0),
            'dislikes':    c_dislikes.get(c.id, 0),
            'my_reaction': c_mine.get(c.id),
        })
    result.sort(key=lambda c: (0 if c['is_pinned'] else 1, 0))
    return jsonify(result)


@pug_bp.route('/pug/api/community/<int:pid>/comment', methods=['POST'])
@limiter.limit("30 per hour; 5 per minute")
def add_post_comment(pid):
    """Add a comment to a post."""
    err = login_required_api()
    if err: return err
    err = _muted_block()
    if err: return err
    me   = session['user_id']
    data = request.get_json(force=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty'}), 400
    if len(text) > 300:
        return jsonify({'error': 'Too long (max 300 chars)'}), 400
    parent = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
    if not parent:
        return jsonify({'error': 'Post not found'}), 404
    c = Note(user_id=me, entry_type='post_comment', is_deleted=False, mood=str(pid))
    c.body = text
    db.session.add(c)
    db.session.commit()
    if parent.user_id != me:
        sk = _post_skill_tag(parent)
        if sk:
            award_exp(parent.user_id, sk, 'comment')
        from shared.auth.user import User
        commenter = User.query.get(me)
        post_snippet = (parent.body or '').strip()[:60]
        notif_body = f'§§NOTIF§§{commenter.username} commented on your post: "{post_snippet}{"…" if len(parent.body or "") > 60 else ""}"§§END§§💬 "{text[:80]}{"…" if len(text) > 80 else ""}"'
        notif = Note(user_id=me, entry_type='dm', is_deleted=False,
                     mood=str(parent.user_id), body=notif_body, is_finished=False)
        db.session.add(notif)
        db.session.commit()
    return jsonify({'id': c.id, 'ok': True}), 201


# ── Cross-distro interaction: act on ANOTHER distro's post, written to ITS store ──
# The merged feed (distro_scope=all) shows other distros' shared posts (svg today). These
# endpoints let a pug user react/comment on those foreign posts: we write directly to the
# owning store's tables (same database) and return pug-shaped JSON so the frontend only has
# to swap the base URL. svg has a single up-vote, so 'like' toggles that vote and 'dislike'
# is a no-op (svg has no downvote — the like→upvote mapping we agreed on).
def _svg_global_post(pid):
    """The svg CommunityPost #pid if it exists and is shared to all distros, else None."""
    from distro.svg.models.community import CommunityPost
    return CommunityPost.query.filter(CommunityPost.id == pid, CommunityPost.is_global.is_(True)).first()


@pug_bp.route('/pug/api/xpost/svg/<int:pid>/react', methods=['POST'])
@limiter.limit("60 per minute")
def xreact_svg(pid):
    """Like/un-like a shared svg post (maps to svg's up-vote; 'dislike' is a no-op)."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    from distro.svg.models.community import PostVote
    post = _svg_global_post(pid)
    if not post:
        return jsonify({'error': 'Not found'}), 404
    rtype    = ((request.get_json(silent=True) or {}).get('type') or '').strip()
    existing = PostVote.query.filter_by(user_id=me, post_id=pid).first()
    if rtype == 'like':
        if existing:
            db.session.delete(existing)
            post.vote_count = max(0, (post.vote_count or 0) - 1)
            existing = None
        else:
            db.session.add(PostVote(user_id=me, post_id=pid))
            post.vote_count = (post.vote_count or 0) + 1
            existing = True
        db.session.commit()
    # 'dislike': svg has no downvote — leave the vote untouched.
    return jsonify({'likes': post.vote_count or 0, 'dislikes': 0,
                    'my_reaction': 'like' if existing else None})


@pug_bp.route('/pug/api/xpost/svg/<int:pid>/comments', methods=['GET'])
def xcomments_svg(pid):
    """List a shared svg post's comments, shaped like pug's comment list."""
    err = login_required_api()
    if err: return err
    from distro.svg.models.community import PostComment
    from shared.auth.user import User
    me = session['user_id']
    if not _svg_global_post(pid):
        return jsonify([])
    rows = PostComment.query.filter_by(post_id=pid).order_by(PostComment.created_at.asc()).limit(50).all()
    umap = {u.id: u for u in User.query.filter(User.id.in_({c.user_id for c in rows})).all()} if rows else {}
    out  = []
    for c in rows:
        u = umap.get(c.user_id)
        if not u: continue
        out.append({
            'id': c.id, 'user_id': c.user_id, 'username': u.username,
            'text': c.body, 'created_at': c.created_at.isoformat() if c.created_at else None,
            'is_mine': c.user_id == me, 'is_pinned': False, 'can_pin': False,
            'likes': 0, 'dislikes': 0, 'my_reaction': None,
        })
    return jsonify(out)


@pug_bp.route('/pug/api/xpost/svg/<int:pid>/comment', methods=['POST'])
@limiter.limit("30 per hour; 5 per minute")
def xcomment_svg(pid):
    """Add a comment to a shared svg post (written to svg's post_comments table)."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    from distro.svg.models.community import PostComment
    if not _svg_global_post(pid):
        return jsonify({'error': 'Post not found'}), 404
    text = ((request.get_json(silent=True) or {}).get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty'}), 400
    if len(text) > 300:
        return jsonify({'error': 'Too long (max 300 chars)'}), 400
    c = PostComment(post_id=pid, user_id=me, body=text)
    db.session.add(c)
    db.session.commit()
    return jsonify({'id': c.id, 'ok': True}), 201


_ACTION_EXP_MAP = {
    'hire':   'purchase_hire',
    'buy':    'purchase_hire',
    'collab': 'collab_request',
    'learn':  'collab_request',
}

@pug_bp.route('/pug/api/community/<int:pid>/action', methods=['POST'])
@limiter.limit("30 per hour; 5 per minute")
def community_post_action(pid):
    """Handle a ShowOff action (Buy/Collab/Learn/Hire) — opens a DM and awards EXP."""
    err = login_required_api()
    if err: return err
    me   = session['user_id']
    data = request.get_json(force=True) or {}
    action = (data.get('action') or '').strip().lower()
    if action not in _ACTION_EXP_MAP:
        return jsonify({'error': 'Invalid action'}), 400
    post = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False).first()
    if not post or post.user_id == me:
        return jsonify({'ok': True})
    # dedup: one EXP award per user per post per action
    action_tag = f'{pid}:{action}'
    already = Note.query.filter_by(
        user_id=me, entry_type='post_action_log', mood=action_tag, is_deleted=False
    ).first()
    if not already:
        log = Note(user_id=me, entry_type='post_action_log', mood=action_tag, is_deleted=False)
        db.session.add(log)
        db.session.commit()
        sk = _post_skill_tag(post)
        if sk:
            award_exp(post.user_id, sk, _ACTION_EXP_MAP[action])
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/community/<int:pid>/comment/<int:cid>/pin', methods=['POST'])
def pin_comment(pid, cid):
    """Pin/unpin a comment on the caller's post."""
    err = login_required_api()
    if err: return err
    me   = session['user_id']
    post = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False, user_id=me).first()
    if not post:
        return jsonify({'error': 'Not your post'}), 403
    body = post.body or ''
    if body.startswith('{'):
        try: bd = json.loads(body)
        except Exception: bd = {'t': body}
    else:
        bd = {'t': body}
    bd['pin'] = None if bd.get('pin') == cid else cid
    post.body = json.dumps({k: v for k, v in bd.items() if v is not None})
    db.session.commit()
    return jsonify({'ok': True, 'pinned': bd.get('pin')})


@pug_bp.route('/pug/api/community/<int:pid>/type', methods=['PATCH'])
def update_post_type(pid):
    """Switch a post between Blog and ShowOff type."""
    err = login_required_api()
    if err: return err
    me        = session['user_id']
    data      = request.get_json(force=True) or {}
    post_type = (data.get('post_type') or '').strip().lower()
    if post_type not in ('blog', 'showoff', ''):
        return jsonify({'error': 'Invalid type'}), 400
    post = Note.query.filter_by(id=pid, entry_type='community_post', is_deleted=False, user_id=me).first()
    if not post:
        return jsonify({'error': 'Not found'}), 404
    body = post.body or ''
    if body.startswith('{'):
        try: bd = json.loads(body)
        except Exception: bd = {'t': body}
    else:
        bd = {'t': body}
    if post_type: bd['pt'] = post_type
    else: bd.pop('pt', None)
    post.body = json.dumps({k: v for k, v in bd.items() if v is not None})
    db.session.commit()
    return jsonify({'ok': True, 'post_type': post_type or None})



# ═════════════════════════════════════════════════════════════════════════════
# USER SEARCH
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/users/search')
def search_users():
    """Search users by username."""
    err = login_required_api()
    if err: return err
    from shared.auth.user import User
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify([])
    me = session['user_id']
    # match by username
    by_name = User.query.filter(
        User.username.ilike(f'%{q}%'),
        User.id != me,
        User.distro.in_(['Ocellus', 'ThePug'])
    ).limit(10).all()
    found = {u.id: u for u in by_name}
    result = []
    for u in list(found.values())[:10]:
        rank, color = _net_rank_for_user(u.id)
        result.append({'id': u.id, 'username': u.username, 'rank': rank, 'rank_color': color, 'is_online': _is_online(u)})
    return jsonify(result)



# ═════════════════════════════════════════════════════════════════════════════
# DIRECT MESSAGES
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/dms/version', methods=['GET'])
def dms_version():
    """Cheap change marker for this user's DMs. New messages are inserts and
    read receipts are updates — both touch Note.updated_at — so clients poll
    this and only re-fetch conversations/messages when the value differs."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    from sqlalchemy import func as sqlfunc, or_
    v = db.session.query(sqlfunc.max(Note.updated_at)).filter(
        Note.entry_type == 'dm',
        or_(Note.user_id == me, Note.mood == str(me))
    ).scalar()
    return jsonify({'v': v.isoformat() if v else ''})


@pug_bp.route('/pug/api/dms', methods=['GET'])
def list_dms():
    """List the caller's DM conversations (latest message per partner)."""
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
            'other_id':    other_id,
            'username':    u.username,
            'last_msg':    raw_body[:60],
            'last_time':   last_msg.created_at.isoformat() if last_msg.created_at else None,
            'unread':      unread_count > 0,
            'unread_count': unread_count,
            'is_online':   _is_online(u),
            'connections': _connection_count(other_id),
        })
    return jsonify(result)


@pug_bp.route('/pug/api/dms/<int:other_id>', methods=['GET'])
def get_dm_thread(other_id):
    """Return the message history with one other user."""
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
    """Send a direct message (rejected if either side blocked the other)."""
    err = login_required_api()
    if err: return err
    err = _muted_block()
    if err: return err
    from shared.auth.user import User
    me = session['user_id']
    if other_id == me:
        return jsonify({'error': 'Cannot DM yourself'}), 400
    recipient = User.query.filter(User.id == other_id, User.distro.in_(['Ocellus', 'ThePug'])).first()
    if not recipient:
        return jsonify({'error': 'User not found'}), 404
    if other_id in _blocked_ids(me):
        return jsonify({'error': 'You cannot message this user.'}), 403
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


@pug_bp.route('/pug/api/dms/<int:other_id>/report', methods=['POST'])
@limiter.limit("20 per hour")
def report_dm(other_id):
    """Report a DM conversation partner. DMs are unmoderated; this records the
    report for admin review (notice-and-action)."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    if other_id == me:
        return jsonify({'error': "You can't report yourself."}), 400
    from shared.auth.user import User
    if not db.session.get(User, other_id):
        return jsonify({'error': 'User not found'}), 404
    reason = ((request.get_json(silent=True) or {}).get('reason') or '').strip()[:300]
    db.session.add(UserReport(reporter_id=me, reported_id=other_id, context='dm', reason=reason))
    _protect_reporter(me, other_id)
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/admin/user-reports', methods=['GET'])
def admin_user_reports():
    """Admin: list DM/user reports for review."""
    err = admin_required_api()
    if err: return err
    from shared.auth.user import User
    rows = UserReport.query.order_by(UserReport.created_at.desc()).limit(200).all()
    out = []
    for r in rows:
        reporter = db.session.get(User, r.reporter_id)
        reported = db.session.get(User, r.reported_id)
        out.append({
            'id':         r.id,
            'reporter':   reporter.username if reporter else str(r.reporter_id),
            'reported':   reported.username if reported else str(r.reported_id),
            'reported_id': r.reported_id,
            'context':    r.context,
            'reason':     r.reason,
            'created_at': r.created_at.isoformat() if r.created_at else None,
        })
    return jsonify(out)


@pug_bp.route('/pug/api/admin/users/<int:uid>/mute', methods=['POST'])
def admin_mute_user(uid):
    """Admin: mute a user. Each call escalates the duration (1d→3d→7d→30d→1y) via
    violation_count. A muted user can't post, comment, or send DMs."""
    err = admin_required_api()
    if err: return err
    from shared.auth.user import User
    u = db.session.get(User, uid)
    if not u:
        return jsonify({'error': 'User not found'}), 404
    u.violation_count = (u.violation_count or 0) + 1
    u.muted_until = _mute_until_for(u.violation_count)
    db.session.commit()
    return jsonify({'ok': True, 'muted_until': u.muted_until.isoformat(),
                    'violation_count': u.violation_count})


@pug_bp.route('/pug/api/admin/users/<int:uid>/unmute', methods=['POST'])
def admin_unmute_user(uid):
    """Admin: lift a mute early. Keeps violation_count, so the next mute still escalates."""
    err = admin_required_api()
    if err: return err
    from shared.auth.user import User
    u = db.session.get(User, uid)
    if not u:
        return jsonify({'error': 'User not found'}), 404
    u.muted_until = None
    db.session.commit()
    return jsonify({'ok': True})


@pug_bp.route('/pug/api/admin/users/<int:uid>/dms', methods=['GET'])
def admin_read_user_dms(uid):
    """Admin: read a reported user's DMs for moderation review.

    GATED — only available for a user who has an OPEN report against them, so an
    admin can't browse arbitrary inboxes. This access is disclosed in the privacy
    policy. NOTE (GDPR/DPDP data-minimisation): full-thread access is broad; have
    the policy wording reviewed before relying on it in production."""
    err = admin_required_api()
    if err: return err
    if not UserReport.query.filter_by(reported_id=uid).first():
        return jsonify({'error': 'No report on file for this user'}), 403
    from shared.auth.user import User
    from sqlalchemy import or_
    if not db.session.get(User, uid):
        return jsonify({'error': 'User not found'}), 404
    # DMs are Notes: user_id = sender, mood = str(recipient). Pull both directions.
    msgs = Note.query.filter(
        Note.entry_type == 'dm', Note.is_deleted == False,
        or_(Note.user_id == uid, Note.mood == str(uid))
    ).order_by(Note.created_at.asc()).limit(1000).all()
    threads = {}
    for m in msgs:
        other = m.mood if m.user_id == uid else str(m.user_id)
        body = m.body or ''
        if body.startswith('{'):
            try: body = (json.loads(body).get('t') or '')
            except Exception: pass
        threads.setdefault(other, []).append({
            'from_uid':   m.user_id,
            'text':       body,
            'created_at': m.created_at.isoformat() if m.created_at else None,
        })
    out = []
    for other_s, items in threads.items():
        ou = db.session.get(User, int(other_s)) if other_s.isdigit() else None
        out.append({'with_uid': int(other_s) if other_s.isdigit() else other_s,
                    'with_username': ou.username if ou else other_s,
                    'messages': items})
    return jsonify({'user_id': uid, 'threads': out})


@pug_bp.route('/pug/api/dms/<int:other_id>/read', methods=['PATCH'])
def mark_dms_read(other_id):
    """Mark the conversation with another user as read."""
    err = login_required_api()
    if err: return err
    me = session['user_id']
    Note.query.filter_by(
        user_id=other_id, mood=str(me), entry_type='dm',
        is_deleted=False, is_finished=False
    ).update({'is_finished': True})
    db.session.commit()
    return jsonify({'ok': True})



# ═════════════════════════════════════════════════════════════════════════════
# ACHIEVEMENTS — log & verify
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/achievements', methods=['GET'])
def get_achievements():
    """List the user's achievements."""
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
    """Add an achievement."""
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
    """Delete an achievement."""
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
    """Submit proof for an achievement to unlock a real rank."""
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


# ═════════════════════════════════════════════════════════════════════════════
# HABITS — create / toggle / history
# ═════════════════════════════════════════════════════════════════════════════
def _client_today():
    """The caller's LOCAL date (sent by the browser as `d=YYYY-MM-DD`), clamped to
    ±1 day of the server's UTC date so it can't be used to backdate streaks. Falls
    back to the server date. Without this, ticks reset on UTC midnight instead of
    the user's local midnight — so e.g. an IST user sees yesterday's ticks until
    05:30 and thinks they "never reset"."""
    from datetime import date, datetime as _dt
    server = date.today()
    raw = request.args.get('d') or (request.get_json(silent=True) or {}).get('d')
    if raw:
        try:
            d = _dt.strptime(raw, '%Y-%m-%d').date()
            if abs((d - server).days) <= 1:
                return d
        except (ValueError, TypeError):
            pass
    return server


@pug_bp.route('/pug/api/habits', methods=['GET'])
@limiter.limit("60 per minute")
def get_habits():
    """List the user's habits with today's status."""
    err = login_required_api()
    if err: return err
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    habits = Habit.query.filter_by(user_id=session['user_id'], is_active=True).order_by(Habit.created_at).all()
    today = _client_today()
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
    """Create a habit."""
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
    """Delete a habit."""
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
    """Toggle today's completion for a habit."""
    err = login_required_api()
    if err: return err
    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog
    from sqlalchemy.exc import IntegrityError
    h = Habit.query.filter_by(id=habit_id, user_id=session['user_id']).first_or_404()
    today = _client_today()
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
    """Return habit completion history."""
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



# ═════════════════════════════════════════════════════════════════════════════
# PROXIES — weather & wisdom (keeps API keys server-side)
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/weather', methods=['GET'])
def proxy_weather():
    """Proxy a weather API request (keeps the API key server-side)."""
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


# Block religious + sexual wisdom (random third-party quotes/facts can be either) —
# the bar is shown to kids and quotes about these topics are a liability. Kept to
# clearly-religious / clearly-sexual terms so secular uses ("have faith") still pass.
_WISDOM_BLOCK = re.compile(r'\b(?:' + '|'.join([
    'god', 'gods', 'jesus', 'christ', 'christian', 'christianity', 'allah',
    'muhammad', 'islam', 'islamic', 'muslim', 'bible', 'biblical', 'quran', 'koran',
    'torah', 'church', 'mosque', 'temple', 'synagogue', 'pray', 'prayer', 'praying',
    'heaven', 'hell', 'gospel', 'scripture', 'buddha', 'buddhist', 'buddhism',
    'hindu', 'hinduism', 'jew', 'jewish', 'judaism', 'religion', 'religious',
    'worship', 'prophet', 'satan', 'devil', 'salvation', 'almighty', 'messiah',
    'sin', 'sinful',
    'sex', 'sexual', 'sexuality', 'orgasm', 'penis', 'vagina', 'erotic', 'erotica',
    'porn', 'pornography', 'nude', 'naked', 'genital', 'genitals', 'masturbate',
    'masturbation', 'intercourse', 'libido', 'horny', 'foreplay', 'fetish', 'sperm',
    'semen', 'condom', 'lust', 'lustful', 'seduce', 'seductive', 'aroused',
]) + r')\b', re.IGNORECASE)
_WISDOM_FALLBACK = [
    'The secret of getting ahead is getting started.',
    'Honeybees can recognize human faces.',
    'Small daily improvements add up to stunning results.',
    'A group of flamingos is called a "flamboyance".',
    'Discipline is choosing between what you want now and what you want most.',
    'Octopuses have three hearts.',
]


@pug_bp.route('/pug/api/wisdom', methods=['GET'])
def proxy_wisdom():
    """Return a daily wisdom quote/fact, filtered to drop religious/sexual content."""
    err = login_required_api()
    if err: return err
    import requests as req
    import random

    def _fetch_one():
        if random.random() > 0.5:
            r = req.get('https://uselessfacts.jsph.pl/api/v2/facts/random', timeout=8)
            r.raise_for_status()
            return r.json().get('text', '')
        r = req.get('https://dummyjson.com/quotes/random', timeout=8)
        r.raise_for_status()
        d = r.json()
        q, a = d.get('quote', ''), d.get('author', '')
        return f'"{q}" — {a}' if q else ''

    # Retry a few times to find a clean one before falling back to a safe canned list.
    for _ in range(5):
        try:
            text = _fetch_one()
        except Exception:
            break
        if text and not _WISDOM_BLOCK.search(text):
            return jsonify({'text': text})
    return jsonify({'text': random.choice(_WISDOM_FALLBACK)})



# ═════════════════════════════════════════════════════════════════════════════
# FEEDBACK
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/feedback', methods=['POST'])
def submit_feedback():
    """Submit user feedback."""
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


_MLC_SAFE_PATH = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._\-/]*$')


def _mlc_path_ok(p):
    return bool(_MLC_SAFE_PATH.match(p)) and '..' not in p and '//' not in p



# ═════════════════════════════════════════════════════════════════════════════
# BLINKBOT MODEL SERVING — WebLLM weights, install & download
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/mlc-weights/<path:filepath>')
def proxy_mlc_weights(filepath):
    """Serve WebLLM model weight shards to the browser (BlinkBot on-device)."""
    err = login_required_api()
    if err: return err
    if not _mlc_path_ok(filepath):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        return _stream_proxy(f'{_MLC_HF_BASE}/{filepath}')
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@pug_bp.route('/pug/mlc-lib/<path:filename>')
def proxy_mlc_lib(filename):
    """Serve WebLLM library files to the browser."""
    err = login_required_api()
    if err: return err
    if not _mlc_path_ok(filename):
        return jsonify({'error': 'Forbidden'}), 403
    try:
        return _stream_proxy(f'{_MLC_LIB_BASE}/{filename}')
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@pug_bp.route('/pug/api/blinkbot-debug', methods=['GET'])
def blinkbot_debug():
    """Debug endpoint reporting BlinkBot model/inference status."""
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
    """Download the BlinkBot GGUF (for desktop/Ollama use)."""
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
    """Download the Ollama Modelfile for BlinkBot."""
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
    """Download the BlinkBot desktop setup script."""
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


# ── Wallet / Credits ──────────────────────────────────────────────────────────

def _get_or_create_wallet(user_id):
    w = Wallet.query.filter_by(user_id=user_id).first()
    if not w:
        w = Wallet(user_id=user_id, balance=0)
        db.session.add(w)
        db.session.commit()
    return w



# ═════════════════════════════════════════════════════════════════════════════
# EYES WALLET & MARKETPLACE — balance, top-up, sell-back, transactions
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/wallet', methods=['GET'])
def get_wallet():
    """Return the user's Eyes wallet balance + recent transactions."""
    err = login_required_api()
    if err: return err
    uid = session['user_id']
    w = _get_or_create_wallet(uid)
    txs = (WalletTx.query
           .filter_by(user_id=uid)
           .order_by(WalletTx.created_at.desc())
           .limit(20).all())
    return jsonify({
        'balance': w.balance,
        'transactions': [{
            'id':         t.id,
            'tx_type':    t.tx_type,
            'amount':     t.amount,
            'ref_id':     t.ref_id,
            'note':       t.note,
            'status':     t.status,
            'created_at': t.created_at.isoformat() if t.created_at else None,
        } for t in txs],
    })


@pug_bp.route('/pug/api/wallet/rates', methods=['GET'])
def get_eye_rates():
    """Return current Eyes buy/sell FX rates."""
    err = login_required_api()
    if err: return err
    refresh_eye_rates()  # no-op if fresh
    rows = EyeRate.query.all()
    return jsonify({r.currency: {
        'buy_rate':  float(r.buy_rate),
        'sell_rate': float(r.sell_rate),
        'min_topup': r.min_topup,
        'symbol':    r.symbol,
    } for r in rows})


def _currency_min(currency):
    """Return min_topup for a currency code, defaulting to 20 if unknown."""
    if not currency:
        return 20
    r = EyeRate.query.get(currency.upper())
    return r.min_topup if r else 20


@pug_bp.route('/pug/api/wallet/topup', methods=['POST'])
def wallet_topup():
    """Request an Eyes top-up (creates a pending transaction)."""
    err = login_required_api()
    if err: return err
    uid = session['user_id']
    body     = request.get_json(silent=True) or {}
    amount   = body.get('amount')
    currency = (body.get('currency') or 'USD').upper()
    min_eyes = _currency_min(currency)
    if not isinstance(amount, int) or amount < min_eyes:
        return jsonify({'error': f'Minimum top-up is {min_eyes} Eyes for {currency}'}), 400
    if amount > 500000:
        return jsonify({'error': 'Maximum top-up is 500,000 Eyes per request'}), 400
    # idempotency: return existing pending request for same amount+currency within 5 min
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(minutes=5)
    existing = WalletTx.query.filter_by(
        user_id=uid, tx_type='topup_request', amount=amount, ref_id=currency, status='pending'
    ).filter(WalletTx.created_at >= cutoff).first()
    if existing:
        return jsonify({'ok': True, 'tx_id': existing.id,
                        'message': 'Top-up request already pending.'})
    tx = WalletTx(
        user_id = uid,
        tx_type = 'topup_request',
        amount  = amount,
        ref_id  = currency,
        note    = f'Top-up request: {amount} Eyes ({currency})',
        status  = 'pending',
    )
    db.session.add(tx)
    db.session.commit()
    return jsonify({'ok': True, 'tx_id': tx.id,
                    'message': 'Top-up request received. Eyes will be added after payment is confirmed.'})


@pug_bp.route('/pug/api/wallet/sellback', methods=['POST'])
def wallet_sellback():
    """Request selling Eyes back for a cash payout."""
    err = login_required_api()
    if err: return err
    uid = session['user_id']
    body     = request.get_json(silent=True) or {}
    amount   = body.get('amount')
    currency = (body.get('currency') or 'USD').upper()
    min_eyes = _currency_min(currency)
    if not isinstance(amount, int) or amount < min_eyes:
        return jsonify({'error': f'Minimum sell-back is {min_eyes} Eyes for {currency}'}), 400
    w = _get_or_create_wallet(uid)
    if w.balance < amount:
        return jsonify({'error': 'Insufficient balance'}), 400
    tx = WalletTx(
        user_id = uid,
        tx_type = 'sellback_request',
        amount  = -amount,
        ref_id  = currency,
        note    = f'Sell-back request: {amount} Eyes ({currency})',
        status  = 'pending',
    )
    db.session.add(tx)
    db.session.commit()
    return jsonify({'ok': True, 'tx_id': tx.id,
                    'message': 'Sell-back request received. Payout will be processed within 3–5 business days.'})


@pug_bp.route('/pug/api/wallet/tx/<int:tx_id>/cancel', methods=['POST'])
def cancel_wallet_tx(tx_id):
    """Cancel a pending wallet transaction."""
    err = login_required_api()
    if err: return err
    uid = session['user_id']
    tx = WalletTx.query.filter_by(id=tx_id, user_id=uid).first()
    if not tx:
        return jsonify({'error': 'Not found'}), 404
    if tx.status != 'pending':
        return jsonify({'error': 'Only pending requests can be cancelled'}), 400
    if tx.tx_type not in ('topup_request', 'sellback_request'):
        return jsonify({'error': 'This transaction cannot be cancelled'}), 400
    tx.status = 'cancelled'
    db.session.commit()
    return jsonify({'ok': True})


# ── Ask Me Anything (human-answered) ─────────────────────────────────────────


# ═════════════════════════════════════════════════════════════════════════════
# ASK ANYTHING (AMA) — human-answered Q&A + admin inbox
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/api/ama', methods=['GET'])
def ama_get():
    """Return the caller's Ask-Anything conversation."""
    err = login_required_api()
    if err: return err
    uid = session['user_id']
    msgs = AmaMessage.query.filter_by(user_id=uid).order_by(AmaMessage.created_at.asc()).all()
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = AmaMessage.query.filter(
        AmaMessage.user_id == uid,
        AmaMessage.is_admin == False,
        AmaMessage.created_at >= today_start,
    ).count()
    w = _get_or_create_wallet(uid)
    return jsonify({
        'messages': [{'id': m.id, 'body': m.body, 'is_admin': m.is_admin,
                      'created_at': m.created_at.isoformat()} for m in msgs],
        'today_count': today_count,
        'balance': w.balance,
    })


@pug_bp.route('/pug/api/ama', methods=['POST'])
def ama_ask():
    """Send an Ask-Anything question (1 free/day, then 1 Eye)."""
    err = login_required_api()
    if err: return err
    uid = session['user_id']
    body = request.get_json(silent=True) or {}
    text = (body.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty question'}), 400
    if len(text) > 2000:
        return jsonify({'error': 'Question too long (max 2000 chars)'}), 400
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = AmaMessage.query.filter(
        AmaMessage.user_id == uid,
        AmaMessage.is_admin == False,
        AmaMessage.created_at >= today_start,
    ).count()
    if today_count >= 1:
        w = _get_or_create_wallet(uid)
        if w.balance < 1:
            return jsonify({'error': 'insufficient_eyes',
                            'message': 'You need 1 Eye for extra questions today.'}), 402
        w.balance -= 1
        db.session.add(WalletTx(
            user_id=uid, tx_type='spend', amount=-1,
            note='Ask Anything: extra question', status='completed',
        ))
    msg = AmaMessage(user_id=uid, body=text, is_admin=False)
    db.session.add(msg)

    # Forward question to Admin-Pug's DMs
    from shared.auth.user import User
    asker = User.query.get(uid)
    admin = User.query.filter_by(username='Admin-Pug').first()
    if admin and asker and admin.id != uid:
        dm_body = f"[Ask Anything]\nFrom: {asker.username}\n\n{text}"
        dm = Note(user_id=uid, entry_type='dm', is_deleted=False, is_finished=False)
        dm.body = dm_body
        dm.mood = str(admin.id)
        db.session.add(dm)

    db.session.commit()
    return jsonify({'ok': True, 'id': msg.id, 'created_at': msg.created_at.isoformat()})


@pug_bp.route('/pug/api/admin/ama', methods=['GET'])
def admin_ama_list():
    """Admin: list users who have asked AMA questions."""
    err = admin_required_api()
    if err: return err
    from sqlalchemy import func
    rows = (db.session.query(AmaMessage.user_id, func.max(AmaMessage.created_at).label('last_at'))
            .group_by(AmaMessage.user_id)
            .order_by(func.max(AmaMessage.created_at).desc())
            .all())
    from shared.auth.user import User
    result = []
    for row in rows:
        u = User.query.get(row.user_id)
        if not u:
            continue
        latest = AmaMessage.query.filter_by(user_id=row.user_id).order_by(AmaMessage.created_at.desc()).first()
        result.append({
            'user_id':       row.user_id,
            'username':      u.username,
            'last_at':       row.last_at.isoformat() if row.last_at else None,
            'preview':       latest.body[:80] if latest else '',
            'is_admin_last': latest.is_admin if latest else False,
        })
    return jsonify(result)


@pug_bp.route('/pug/api/admin/ama/<int:uid>', methods=['GET'])
def admin_ama_thread(uid):
    """Admin: return one user's AMA thread."""
    err = admin_required_api()
    if err: return err
    from shared.auth.user import User
    u = User.query.get(uid)
    msgs = AmaMessage.query.filter_by(user_id=uid).order_by(AmaMessage.created_at.asc()).all()
    return jsonify({
        'username': u.username if u else str(uid),
        'messages': [{'id': m.id, 'body': m.body, 'is_admin': m.is_admin,
                      'created_at': m.created_at.isoformat()} for m in msgs],
    })


@pug_bp.route('/pug/api/admin/ama/<int:uid>/reply', methods=['POST'])
def admin_ama_reply(uid):
    """Admin: reply to a user's AMA question."""
    err = admin_required_api()
    if err: return err
    from shared.auth.user import User
    if not User.query.get(uid):
        return jsonify({'error': 'User not found'}), 404
    body = request.get_json(silent=True) or {}
    text = (body.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Empty reply'}), 400
    msg = AmaMessage(user_id=uid, body=text, is_admin=True)
    db.session.add(msg)
    db.session.commit()
    return jsonify({'ok': True, 'id': msg.id, 'created_at': msg.created_at.isoformat()})



# ═════════════════════════════════════════════════════════════════════════════
# TERMS PAGE
# ═════════════════════════════════════════════════════════════════════════════
@pug_bp.route('/pug/terms')
def pug_terms():
    """Render the pug terms-of-service page."""
    return render_template('pug/terms.html')