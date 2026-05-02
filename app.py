from flask import Flask
from flask_mail import Mail
from svg_config import Config
from svg_models import db
from svg_services.badge_service import seed_badges

# Your existing blueprint
from routes.divyanshu_routes.droute import divyanshu_bp

mail = Mail()

def create_app():
    app = Flask(
        __name__,
        template_folder='/home/eco-svg/warehouse2/Blankit/templates',
        static_folder='/home/eco-svg/warehouse2/Blankit/static',
    )

    app.config.from_object(Config)

    db.init_app(app)
    mail.init_app(app)

    from routes.svg_routes.svg_route import svg
    from routes.svg_routes.api_route import api
    from routes.auth_route import auth, init_mail

    init_mail(mail)

    # Register all routes
    app.register_blueprint(svg)
    app.register_blueprint(api)
    app.register_blueprint(auth)
    app.register_blueprint(divyanshu_bp)  # ← your original route kept

    with app.app_context():
        db.create_all()
        seed_badges()

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)