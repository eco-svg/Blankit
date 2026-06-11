import os
from flask import Flask, session, render_template
from flask_mail import Mail
from werkzeug.middleware.proxy_fix import ProxyFix
from shared.config import Config
from shared.extensions import db
from distro.svg.services.badge_service import seed_badges
from shared.extensions import limiter

_DATA_DIR = '/data' if os.path.isdir('/data') else os.path.dirname(os.path.abspath(__file__))


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
from distro.divyanshu.routes.droute import catalystcrew_bp
from distro.pug.routes.pug_route import pug_bp

mail = Mail()


def _migrate_schema():
    """Idempotent startup migrations for schema changes not handled by db.create_all()."""
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)

    # ── wallet tables ──
    tables = inspector.get_table_names()
    if 'wallets' not in tables:
        try:
            with db.engine.begin() as conn:
                conn.execute(text('''
                    CREATE TABLE wallets (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                        balance INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
        except Exception as e:
            import warnings; warnings.warn(f'[migrate] wallets: {e}')
    if 'wallet_transactions' not in tables:
        try:
            with db.engine.begin() as conn:
                conn.execute(text('''
                    CREATE TABLE wallet_transactions (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        tx_type VARCHAR(30) NOT NULL,
                        amount INTEGER NOT NULL,
                        ref_id VARCHAR(100),
                        note VARCHAR(300),
                        status VARCHAR(20) NOT NULL DEFAULT \'pending\',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
        except Exception as e:
            import warnings; warnings.warn(f'[migrate] wallet_transactions: {e}')
    if 'eye_rates' not in tables:
        try:
            with db.engine.begin() as conn:
                conn.execute(text('''
                    CREATE TABLE eye_rates (
                        currency  VARCHAR(10) PRIMARY KEY,
                        buy_rate  NUMERIC(18,8) NOT NULL,
                        sell_rate NUMERIC(18,8) NOT NULL,
                        min_topup INTEGER NOT NULL DEFAULT 20,
                        symbol    VARCHAR(10) DEFAULT \'\',
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
        except Exception as e:
            import warnings; warnings.warn(f'[migrate] eye_rates: {e}')

    # ── user_badges migration ──
    if 'user_badges' in inspector.get_table_names():
        columns = {c['name'] for c in inspector.get_columns('user_badges')}
        if 'user_id' not in columns:
            try:
                with db.engine.begin() as conn:
                    conn.execute(text('ALTER TABLE user_badges ADD COLUMN user_id INTEGER REFERENCES users(id)'))
                    conn.execute(text('DELETE FROM user_badges WHERE user_id IS NULL'))
                try:
                    with db.engine.begin() as conn:
                        conn.execute(text('ALTER TABLE user_badges ALTER COLUMN user_id SET NOT NULL'))
                except Exception:
                    pass  # SQLite doesn't support this; PostgreSQL does
            except Exception as e:
                import warnings
                warnings.warn(f'[migrate] user_badges migration failed: {e}')

    # ── users new columns ──
    if 'users' in inspector.get_table_names():
        new_cols = [
            ('age',                  'INTEGER'),
            ('student_status',       "VARCHAR(20) DEFAULT 'none'"),
            ('student_school',       'VARCHAR(200)'),
            ('student_location',     'VARCHAR(200)'),
            ('student_grade',        'VARCHAR(50)'),
            ('student_submitted_at', 'TIMESTAMP'),
            ('student_id_url',       'VARCHAR(500)'),
            ('dob',                  'DATE'),
            ('last_seen',            'TIMESTAMP'),
            ('is_admin',             'BOOLEAN DEFAULT FALSE'),
        ]
        existing = {c['name'] for c in inspector.get_columns('users')}
        for col, col_type in new_cols:
            if col not in existing:
                try:
                    with db.engine.begin() as conn:
                        conn.execute(text(f'ALTER TABLE users ADD COLUMN {col} {col_type}'))
                except Exception as e:
                    import warnings
                    warnings.warn(f'[migrate] Could not add column {col}: {e}')

        # Grant admin to the designated admin account (idempotent)
        admin_username = os.environ.get('ADMIN_USERNAME', 'Admin-Pug')
        try:
            with db.engine.begin() as conn:
                conn.execute(text(
                    'UPDATE users SET is_admin = TRUE WHERE username = :u '
                    'AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin IS TRUE)'
                ), {'u': admin_username})
        except Exception as e:
            import warnings
            warnings.warn(f'[migrate] Could not grant admin flag: {e}')

    # ── verify_tokens: failed-attempt counter ──
    if 'verify_tokens' in inspector.get_table_names():
        vt_cols = {c['name'] for c in inspector.get_columns('verify_tokens')}
        if 'attempts' not in vt_cols:
            try:
                with db.engine.begin() as conn:
                    conn.execute(text('ALTER TABLE verify_tokens ADD COLUMN attempts INTEGER DEFAULT 0'))
            except Exception as e:
                import warnings
                warnings.warn(f'[migrate] verify_tokens.attempts: {e}')


def _migrate_fk_cascades():
    """Idempotent: add ON DELETE CASCADE to all FK constraints referencing users.id (and habits.id)."""
    from sqlalchemy import text
    if 'postgresql' not in str(db.engine.url):
        return
    try:
        with db.engine.begin() as conn:
            already = conn.execute(text("""
                SELECT COUNT(*) FROM information_schema.referential_constraints
                WHERE constraint_name = 'verify_tokens_user_id_fkey'
                AND delete_rule = 'CASCADE'
            """)).scalar()
            if already:
                return
            for table, constraint, col, ref_table in [
                ('verify_tokens', 'verify_tokens_user_id_fkey', 'user_id',  'users'),
                ('reset_tokens',  'reset_tokens_user_id_fkey',  'user_id',  'users'),
                ('habits',        'habits_user_id_fkey',         'user_id',  'users'),
                ('todos',         'todos_user_id_fkey',          'user_id',  'users'),
                ('user_badges',   'user_badges_user_id_fkey',    'user_id',  'users'),
                ('notes',         'notes_user_id_fkey',          'user_id',  'users'),
                ('habit_logs',    'habit_logs_habit_id_fkey',    'habit_id', 'habits'),
            ]:
                conn.execute(text(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}'))
                conn.execute(text(
                    f'ALTER TABLE {table} ADD CONSTRAINT {constraint} '
                    f'FOREIGN KEY ({col}) REFERENCES {ref_table}(id) ON DELETE CASCADE'
                ))
    except Exception as e:
        import warnings
        warnings.warn(f'[startup] FK cascade migration failed: {e}')


def _migrate_distro_names():
    """Rename old distro keys to new branded names (one-time, idempotent)."""
    from sqlalchemy import text
    mapping = {'ecosvg': 'Eco-Svg', 'ocellus': 'Ocellus', 'divyanhu': 'CatalystCrew'}
    try:
        with db.engine.begin() as conn:
            for old, new in mapping.items():
                conn.execute(text("UPDATE users SET distro = :new WHERE distro = :old"),
                             {'old': old, 'new': new})
    except Exception as e:
        import warnings
        warnings.warn(f'[startup] Distro name migration failed: {e}')


def _sync_sequences():
    """Re-align PostgreSQL serial sequences with actual max IDs to prevent UniqueViolation on insert."""
    from sqlalchemy import text
    if 'postgresql' not in str(db.engine.url):
        return
    tables = ['users', 'verify_tokens', 'reset_tokens']
    try:
        with db.engine.begin() as conn:
            for table in tables:
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"GREATEST(COALESCE((SELECT MAX(id) FROM {table}), 1), 1))"
                ))
    except Exception as e:
        import warnings
        warnings.warn(f'[startup] Sequence sync failed: {e}')


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
        is_prod = (os.environ.get('RENDER')  # set automatically on Render
                   or os.getenv('FLASK_ENV', 'development') != 'development')
        if is_prod:
            raise RuntimeError('SECRET_KEY must be set in production — refusing to start with a forgeable session key.')
        import warnings
        warnings.warn("SECRET_KEY not set — using insecure fallback (dev only).", stacklevel=2)
        secret = 'dev-only-change-in-prod'
    app.config['SECRET_KEY'] = secret
    db_url = os.environ.get('DATABASE_URL', 'sqlite:///veyra.db')
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
    from distro.svg.routes.ai_route  import ai
    from shared.auth.auth_route import auth, init_mail
    from distro.svg.routes.community_route import community_api

    init_mail(mail)

    app.register_blueprint(svg)
    app.register_blueprint(api)
    app.register_blueprint(ai)
    app.register_blueprint(community_api)
    app.register_blueprint(auth)
    app.register_blueprint(catalystcrew_bp)
    app.register_blueprint(pug_bp)

    # ── PWA service worker (must be served from root scope) ──
    @app.route('/sw.js')
    def service_worker():
        from flask import send_from_directory
        resp = send_from_directory(app.static_folder, 'sw.js')
        resp.headers['Service-Worker-Allowed'] = '/'
        resp.headers['Cache-Control'] = 'no-cache'
        return resp

    @app.route('/favicon.ico')
    def favicon():
        from flask import send_from_directory
        return send_from_directory(
            os.path.join(app.static_folder, 'icons'),
            'icon-192.png',
            mimetype='image/png',
        )

    # ── Invalidate sessions for deleted users ──
    @app.before_request
    def validate_session_user():
        user_id = session.get('user_id')
        if not user_id:
            return
        from shared.auth.user import User
        if db.session.get(User, user_id):
            return
        session.clear()
        from flask import request as _req, redirect, url_for, jsonify
        if _req.path.startswith('/api/') or _req.headers.get('Accept', '').startswith('application/json'):
            return jsonify({'error': 'session_invalidated', 'message': 'Your account no longer exists.'}), 401
        return redirect(url_for('svg.login') + '?kicked=1')

    # ── Security response headers ──
    @app.after_request
    def security_headers(response):
        response.headers['X-Frame-Options']        = 'SAMEORIGIN'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob:; "
            "connect-src 'self'; "
            "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; "
            "frame-ancestors 'self' https://huggingface.co; "
            "object-src 'none'; "
            "base-uri 'self';"
        )
        return response

    @app.route('/privacy')
    def privacy(): return render_template('shared/privacy.html')

    @app.route('/terms')
    def terms(): return render_template('shared/terms.html')

    @app.route('/under13')
    def under13(): return render_template('shared/under13.html')

    if os.environ.get('ENABLE_LOCAL_INFERENCE', 'auto').lower() != 'false':
        _ensure_blinkbot_model()
        _ensure_buddybot_model()

    if (os.environ.get('MINIO_ACCESS_KEY', 'minioadmin') == 'minioadmin'
            and os.environ.get('FLASK_ENV') != 'development'):
        import warnings
        warnings.warn('MinIO is using default credentials in a non-dev environment!', stacklevel=2)

    with app.app_context():
        db.create_all()
        _migrate_schema()
        _migrate_fk_cascades()
        _migrate_distro_names()
        _sync_sequences()
        seed_badges()
        from distro.pug.routes.notes import refresh_eye_rates
        refresh_eye_rates()

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 7860))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug, host='0.0.0.0', port=port, use_reloader=False)