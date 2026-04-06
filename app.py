import os
from flask import Flask
from routes.divyanshu_routes.droute import divyanshu_bp

app = Flask(__name__, static_folder='static')

# Register your blueprint
app.register_blueprint(divyanshu_bp)

if __name__ == '__main__':
    # Running on 0.0.0.0 allows you to access it via your IP: 10.200.49.148
    app.run(debug=True, host='0.0.0.0', port=5000)