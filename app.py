from flask import Flask
from svg_config import Config
from svg_models import db
from svg_services.badge_service import seed_badges

def create_app():
    app = Flask(
        __name__,
        template_folder='/home/eco-svg/warehouse2/Blankit/templates',
        static_folder  ='/home/eco-svg/warehouse2/Blankit/static',
    )
    app.config.from_object(Config)

    # ── init db ──────────────────────────────────────────────
    db.init_app(app)

    # ── register blueprints ──────────────────────────────────
    from routes.svg_routes.svg_route import svg
    from routes.svg_routes.api_route import api
    from routes.auth_route import auth
    app.register_blueprint(svg)
    app.register_blueprint(api)
    app.register_blueprint(auth)

    # ── create tables + seed badges on first run ─────────────
    with app.app_context():
        db.create_all()
        seed_badges()

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True)