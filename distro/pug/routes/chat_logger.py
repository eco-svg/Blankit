"""
distro/pug/routes/chat_logger.py — encrypted per-user AI chat history.

Each user's BlinkBot conversation is appended to their own file (~/.veyra_logs/user_<id>.py),
grouped by day. The whole file is stored encrypted (see distro/pug/extensions.py) and
decrypted only when read back. Files live OUTSIDE the project so Flask's dev auto-reloader
doesn't restart the server every time a chat is logged.
"""
import os
from datetime import datetime
from distro.pug.extensions import encrypt, decrypt

# Stored outside the project root so Flask's file watcher never triggers a reload
_LOGS_DIR = os.environ.get(
    'VEYRA_CHAT_LOGS',
    os.path.expanduser('~/.veyra_logs')
)


def _log_path(user_id):
    """Path to this user's encrypted chat-log file (creating the logs dir if needed)."""
    os.makedirs(_LOGS_DIR, exist_ok=True)
    return os.path.join(_LOGS_DIR, f'user_{user_id}.py')


def _day_header(dt):
    """A per-day divider line, e.g. '_____Friday, 13 June 2026_____:'."""
    return f"_____{ dt.strftime('%A, %d %B %Y') }_____:"


def append_chat_entry(user_id, user_message, bot_response):
    """Append one user/bot exchange to the user's log (under today's date header), re-encrypting the file."""
    now = datetime.now()
    path = _log_path(user_id)

    if os.path.exists(path):
        with open(path, 'r') as f:
            raw = f.read().strip()
        try:
            content = decrypt(raw)
        except Exception:
            content = ''
    else:
        content = ''

    today_header = _day_header(now)
    time_str = now.strftime('%H:%M')
    entry = f'[{time_str}] You: {user_message}\n[{time_str}] BlinkBot: {bot_response}'

    if today_header in content:
        content = content + '\n' + entry
    elif content:
        content = content + '\n\n' + today_header + '\n\n' + entry
    else:
        content = today_header + '\n\n' + entry

    with open(path, 'w') as f:
        f.write(encrypt(content))


def read_user_log(user_id):
    """Return the user's full decrypted chat history, or None if they have no log yet."""
    path = _log_path(user_id)
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        raw = f.read().strip()
    return decrypt(raw)
