import os
from dotenv import load_dotenv
load_dotenv()

class Config:
    SECRET_KEY                  = os.getenv('SECRET_KEY')
    SQLALCHEMY_DATABASE_URI     = os.getenv('DATABASE_URL')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DISTRO                      = os.getenv('DISTRO', 'Eco-Svg')

    # Session cookie hardening
    SESSION_COOKIE_HTTPONLY  = True
    SESSION_COOKIE_SAMESITE  = 'Lax'
    SESSION_COOKIE_SECURE    = os.getenv('FLASK_ENV', 'production') != 'development'

    # Flask-Mail
    MAIL_SERVER                 = 'smtp.gmail.com'
    MAIL_PORT                   = 587
    MAIL_USE_TLS                = True
    MAIL_USERNAME               = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD               = os.getenv('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER         = ('VEYRA', os.getenv('MAIL_USERNAME'))