"""Config + message templating for the Rightmove enquiry form-filler.

Secrets and identity live in data/enquiry.json (gitignored), never in code:

    {
      "captcha_api_key": "...",
      "contact": {
        "first_name": "Elsie",
        "last_name": "Bennett",
        "email": "enquiries@...",
        "phone": "07426495169",
        "postcode": "CV1 2AB"
      }
    }

The contact NAME is deliberately "Elsie" so that when an agent calls back and
asks for Elsie, the inbound receptionist knows it is a property enquiry (asking
for Hugo = personal). See [[project_brrr_qualifier]].
"""
import os
import json
from pathlib import Path

_DATA = Path(__file__).parent / "data"
_CONFIG_PATH = _DATA / "enquiry.json"

# Sensible fallbacks so a missing field never crashes the fill; the message
# still reads naturally and the agent can always call the number back.
_DEFAULT_CONTACT = {
    "first_name": "Elsie",
    "last_name": "Bennett",
    "email": "",
    "phone": "07426495169",
    "postcode": "",
}


def load_enquiry_config():
    """Return (captcha_api_key, contact_dict). Env wins over the JSON file."""
    raw = {}
    if _CONFIG_PATH.exists():
        try:
            raw = json.loads(_CONFIG_PATH.read_text())
        except (ValueError, OSError):
            raw = {}
    captcha_key = os.environ.get("CAPTCHA_API_KEY") or raw.get("captcha_api_key", "")
    contact = {**_DEFAULT_CONTACT, **(raw.get("contact") or {})}
    return captcha_key, contact


def build_enquiry_message(property_row, contact):
    """The note left on the agent's enquiry form: cash-buyer, please-call.

    Deliberately asks them to phone us back rather than email — a live
    conversation qualifies far better, and the callback flows into the same
    inbound pipeline. Mentions the property so the reply is unambiguous.
    """
    address = (property_row or {}).get("address") or "your listing"
    phone = contact.get("phone") or ""
    lines = [
        f"Hi, I'm interested in {address}.",
        "We're cash buyers with no chain and can move quickly.",
        "I have a couple of quick questions before we put an offer forward — "
        f"would you be able to give me a call on {phone}? Ask for Elsie.",
        "Happy to discuss whenever suits. Thanks!",
    ]
    return " ".join(p for p in lines if p.strip())
