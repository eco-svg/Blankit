import os
from flask import Flask
from flask_mail import Mail
from werkzeug.middleware.proxy_fix import ProxyFix
from svg_config import Config
from svg_models import db
from svg_services.badge_service import seed_badges
from extensions import limiter


def _ensure_buddybot_model():
    if os.environ.get('BUDDYBOT_ENABLED', 'false').lower() != 'true':
        return
    model_path = os.environ.get(
        'BUDDYBOT_PATH',
        '/app/pug_modals/buddybot/BuddyBot_8B_Final.Q4_K_M.gguf'
    )
    if os.path.exists(model_path):
        return
    repo_id = os.environ.get('BUDDYBOT_REPO', 'SomeWhatPug/blankit-buddybot')
    token   = os.environ.get('HF_TOKEN')
    print(f'[startup] BuddyBot model not found — downloading from {repo_id}...')
    os.makedirs(os.path.dirname(model_path), exist_ok=True)
    try:
        from huggingface_hub import hf_hub_download
        hf_hub_download(
            repo_id=repo_id,
            filename='BuddyBot_8B_Final.Q4_K_M.gguf',
            local_dir=os.path.dirname(model_path),
            token=token,
        )
        print('[startup] BuddyBot model ready.')
    except Exception as e:
        print(f'[startup] BuddyBot download failed: {e}')

# Blueprints
from routes.divyanshu_routes.droute import divyanshu_bp
from routes.pug_routes.pug_route import pug_bp

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
            pass  # SQLite doesn't support this; PostgreSQL (Supabase) does


def create_app():
    app = Flask(
        __name__,
        template_folder='templates',
        static_folder='static',
    )
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

    # Config
    app.config.from_object(Config)
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-only-change-in-prod')
    db_url = os.environ.get('DATABASE_URL', 'sqlite:///blankit.db')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    # SINGLE DB INIT (important)
    db.init_app(app)

    # Mail + rate limiter
    mail.init_app(app)
    limiter.init_app(app)

    # Import SVG routes
    from routes.svg_routes.svg_route import svg
    from routes.svg_routes.api_route import api
    from routes.auth_route import auth, init_mail

    init_mail(mail)

    # Register ALL systems
    app.register_blueprint(svg)
    app.register_blueprint(api)
    app.register_blueprint(auth)
    app.register_blueprint(divyanshu_bp)
    app.register_blueprint(pug_bp)

    # Init DB
    with app.app_context():
        db.create_all()
        _migrate_schema()
        seed_badges()

    return app


if __name__ == '__main__':
    _ensure_buddybot_model()
    app = create_app()
    port = int(os.environ.get('PORT', 7860))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug, host='0.0.0.0', port=port, use_reloader=False)
