import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_raw_key = os.environ.get('BLANKIT_KEY')
if not _raw_key:
    raise RuntimeError("BLANKIT_KEY environment variable not set.")

_fernet = Fernet(_raw_key.encode())


def encrypt(text: str) -> str:
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()
