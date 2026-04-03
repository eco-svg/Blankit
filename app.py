<<<<<<< HEAD
import os
from flask import Flask
from routes.divyanshu_routes.droute import divyanshu_bp

app = Flask(__name__, static_folder='static')

# Register your blueprint
app.register_blueprint(divyanshu_bp)

if __name__ == '__main__':
    # Running on 0.0.0.0 allows you to access it via your IP: 10.200.49.148
    app.run(debug=True, host='0.0.0.0', port=5000)
=======
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

    # ── init db ──────────────────────────────────────────────────
    db.init_app(app)

    # ── register blueprints ──────────────────────────────────────
    from routes.svg_routes.svg_route import svg
    from routes.svg_routes.api_route import api
    app.register_blueprint(svg)
    app.register_blueprint(api)

    # ── create tables + seed badges on first run ─────────────────
    with app.app_context():
        db.create_all()
        from svg_services.badge_service import seed_badges
        seed_badges()

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True)
>>>>>>> b62fa36 (base modal 2.3)
