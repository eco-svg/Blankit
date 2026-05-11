from flask import Flask
from flask_mail import Mail
from svg_config import Config
from svg_models import db
from svg_services.badge_service import seed_badges

# Blueprints
from routes.divyanshu_routes.droute import divyanshu_bp
from routes.pug_routes.pug_route import pug_bp

mail = Mail()


def create_app():
    app = Flask(
        __name__,
        template_folder='templates',
        static_folder='static',
    )

    app.secret_key = "abc123"

    # Config
    app.config.from_object(Config)
    app.config['SECRET_KEY'] = 'abc123'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///blankit.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    # SINGLE DB INIT (important)
    db.init_app(app)

    # Mail
    mail.init_app(app)

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
        seed_badges()

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
