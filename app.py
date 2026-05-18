import os
from flask import Flask
from flask_mail import Mail
from werkzeug.middleware.proxy_fix import ProxyFix
from shared.config import Config
from shared.models import db
from distro.svg.services.badge_service import seed_badges
from shared.extensions import limiter

# /data is the HF persistent bucket mount; fall back to /app for local dev
_DATA_DIR = '/data' if os.path.isdir('/data') else '/app'


def _hf_download(repo_id, filename, dest_path, token):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    try:
        from huggingface_hub import hf_hub_download
        hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            local_dir=os.path.dirname(dest_path),
            token=token,
        )
        print(f'[startup] Downloaded {filename} → {dest_path}')
        return True
    except Exception as e:
        print(f'[startup] Download failed ({repo_id}/{filename}): {e}')
        return False


def _ensure_blinkbot_model():
    """Download BlinkBot GGUF to /data so the proxy can serve it directly to the browser."""
    default_path = os.path.join(_DATA_DIR, 'distro', 'pug', 'llm', 'blinkbot', 'BlinkBot_1.5Binal.Q4_K_M.gguf')
    model_path   = os.environ.get('BLINKBOT_PATH', default_path)
    if os.path.exists(model_path):
        print(f'[startup] BlinkBot found: {model_path}')
        return
    repo_id  = os.environ.get('BLINKBOT_REPO',    'SomeWhatPug/Buddybot_veyra')
    filename = os.environ.get('BLINKBOT_FILENAME', 'BlinkBot_1.5Binal.Q4_K_M.gguf')
    token    = os.environ.get('HF_TOKEN')
    print(f'[startup] BlinkBot not found — downloading from {repo_id}/{filename} ...')
    _hf_download(repo_id, filename, model_path, token)


def _ensure_buddybot_model():
    default_path = os.path.join(_DATA_DIR, 'distro', 'pug', 'llm', 'buddybot', 'BuddyBot_8B_Final.Q4_K_M.gguf')
    model_path   = os.environ.get('BUDDYBOT_PATH', default_path)
    if os.path.exists(model_path):
        print(f'[startup] BuddyBot found: {model_path}')
        return
    repo_id  = os.environ.get('BUDDYBOT_REPO',    'SomeWhatPug/Buddybot_veyra')
    filename = os.environ.get('BUDDYBOT_FILENAME', 'BuddyBot_8B_Final.Q4_K_M.gguf')
    token    = os.environ.get('HF_TOKEN')
    print(f'[startup] BuddyBot not found — downloading from {repo_id}/{filename} ...')
    _hf_download(repo_id, filename, model_path, token)



# Blueprints
from distro.divyanshu.routes.droute import divyanshu_bp
from distro.pug.routes.pug_route import pug_bp

mail = Mail()


def _migrate_schema():
    """Idempotent startup migrations for schema changes not handled by db.create_all()."""
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)
    if 'user_badges' not in inspector.get_table_names():
        return  # table not yet created — db.create_all() will handle it correctly
    columns = {c['name'] for c in inspector.get_columns('user_badges')}
    if 'user_id' in columns:
        return  # already migrated
    with db.engine.begin() as conn:
        conn.execute(text('ALTER TABLE user_badges ADD COLUMN user_id INTEGER REFERENCES users(id)'))
        conn.execute(text('DELETE FROM user_badges WHERE user_id IS NULL'))
        try:
            conn.execute(text('ALTER TABLE user_badges ALTER COLUMN user_id SET NOT NULL'))
        except Exception:
            pass  # SQLite doesn't support this; PostgreSQL does


def create_app():
    app = Flask(
        __name__,
        template_folder='shared/templates',
        static_folder='shared/static',
    )
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

    # Config
    app.config.from_object(Config)
    secret = os.environ.get('SECRET_KEY')
    if not secret:
        import warnings
        warnings.warn("SECRET_KEY not set — using insecure fallback. Set it in production!", stacklevel=2)
        secret = 'dev-only-change-in-prod'
    app.config['SECRET_KEY'] = secret
    db_url = os.environ.get('DATABASE_URL', 'sqlite:///blankit.db')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload cap
    db.init_app(app)

    mail.init_app(app)
    limiter.init_app(app)

    from distro.svg.routes.svg_route import svg
    from distro.svg.routes.api_route import api
    from shared.auth.auth_route import auth, init_mail

    init_mail(mail)

    app.register_blueprint(svg)
    app.register_blueprint(api)
    app.register_blueprint(auth)
    app.register_blueprint(divyanshu_bp)
    app.register_blueprint(pug_bp)

    # ── Security response headers ─────────────────────────
    @app.after_request
    def security_headers(response):
        response.headers['X-Frame-Options']        = 'DENY'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "base-uri 'self';"
        )
        return response

    with app.app_context():
        db.create_all()
        _migrate_schema()
        seed_badges()

    return app


if __name__ == '__main__':
    _ensure_blinkbot_model()
    _ensure_buddybot_model()
    app = create_app()
    port = int(os.environ.get('PORT', 7860))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug, host='0.0.0.0', port=port, use_reloader=False)
