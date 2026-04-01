import os
from flask_sqlalchemy import SQLAlchemy
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

db = SQLAlchemy()

_raw_key = os.environ.get('BLANKIT_KEY')

if not _raw_key:
    raise RuntimeError("BLANKIT_KEY environment variable not set.")

fernet = Fernet(_raw_key.encode())

def encrypt(text: str) -> str:
    return fernet.encrypt(text.encode()).decode()

def decrypt(token: str) -> str:
    return fernet.decrypt(token.encode()).decode()