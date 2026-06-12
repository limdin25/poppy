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


# Default pitch templates — {address} and {phone} are filled per enquiry.
# Editable in the UI (stored in data/enquiry.json under "pitches").
DEFAULT_PITCHES = {
    "sale": ("Hi, I'm interested in {address}. We're cash buyers with no chain "
             "and can move quickly. I have a couple of quick questions before we "
             "put an offer forward — would you be able to give me a call on "
             "{phone}? Ask for Elsie. Happy to discuss whenever suits. Thanks!"),
    "rent": ("Hi, I'm interested in {address} as a long-term let. We're a "
             "property management company looking for good homes to rent on a "
             "3–5 year basis — guaranteed rent every month, fully managed, no "
             "voids or hassle for the landlord. Could you give me a quick call "
             "to discuss? Ask for Elsie on {phone}."),
}


def load_pitch(kind="sale"):
    """Return the (editable) pitch template for 'sale' or 'rent'."""
    raw = {}
    if _CONFIG_PATH.exists():
        try:
            raw = json.loads(_CONFIG_PATH.read_text())
        except (ValueError, OSError):
            raw = {}
    pitches = raw.get("pitches") or {}
    return pitches.get(kind) or DEFAULT_PITCHES.get(kind, DEFAULT_PITCHES["sale"])


def save_pitch(kind, text):
    """Persist an edited pitch template (UI-editable)."""
    raw = {}
    if _CONFIG_PATH.exists():
        try:
            raw = json.loads(_CONFIG_PATH.read_text())
        except (ValueError, OSError):
            raw = {}
    raw.setdefault("pitches", {})[kind] = text
    _DATA.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(json.dumps(raw, indent=2))


def render_pitch(template, property_row, contact):
    """Fill {address}/{phone} in a pitch template."""
    address = (property_row or {}).get("address") or "your listing"
    phone = contact.get("phone") or ""
    try:
        return template.format(address=address, phone=phone)
    except (KeyError, IndexError, ValueError):
        # tolerate stray braces in a user-edited template
        return template.replace("{address}", address).replace("{phone}", phone)


def build_enquiry_message(property_row, contact, kind="sale"):
    """The note left on the agent's enquiry form (editable pitch, placeholders filled)."""
    return render_pitch(load_pitch(kind), property_row, contact)
