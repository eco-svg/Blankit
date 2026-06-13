"""
distro/pug/extensions.py — at-rest encryption for the pug distro.

Sensitive user text (note titles/bodies, chat logs) is encrypted before it's stored and
decrypted on read, using one symmetric key (Fernet) from the VEYRA_KEY env var. If a
value can't be decrypted, decrypt() returns '' instead of crashing the request.
"""
import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

# The key is mandatory — the app refuses to start without it (no insecure fallback).
_raw_key = os.environ.get('VEYRA_KEY')
if not _raw_key:
    raise RuntimeError("VEYRA_KEY environment variable not set.")

_fernet = Fernet(_raw_key.encode())


def encrypt(text: str) -> str:
    """Encrypt a plain string into a Fernet token (safe to store in the DB)."""
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    """Decrypt a Fernet token back to plain text; return '' if it can't be decrypted."""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except Exception:
        return ''
