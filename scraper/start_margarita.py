"""Local launcher for Hugo's Margarita property tool.

Auto-started at login by the LaunchAgent com.margarita.propertytool.
Binds to 127.0.0.1:5050 (local-only, kept separate from the other
scraper app on 5001 so they never clash).
"""
import storage
import facebook_storage
import rightmove_storage
from app import app

if __name__ == "__main__":
    storage.init_db()
    facebook_storage.init_db()
    rightmove_storage.init_db()
    app.run(host="127.0.0.1", port=5050, debug=False, threaded=True)
