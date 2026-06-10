"""Production launcher: bind 0.0.0.0:5001 for external access."""
import storage, facebook_storage, rightmove_storage
from app import app

if __name__ == "__main__":
    storage.init_db()
    facebook_storage.init_db()
    rightmove_storage.init_db()
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
