# Redact the proof of funds so it can be emailed to strangers.
#
# Hugo: "hide sort code and IBANs to stop fraud."
#
# THIS IS A REAL REDACTION, NOT A BLACK BOX. Drawing a rectangle over text
# leaves the text underneath, and anybody can select it or run pdftotext over
# it. PyMuPDF's apply_redactions() deletes the glyphs from the content stream,
# which is why it is used here, and why the script re-extracts the text
# afterwards and fails loudly if a single sort code survived.
#
# WHAT GOES, and why it is more than Hugo listed: sort code, IBAN, account
# number, and the US routing numbers. A sort code alone is not what commits
# fraud, the PAIR is, so hiding the sort code and leaving the account number
# beside it would be theatre. What stays is everything that makes the document
# proof: the company, the registration number, every balance, the certification
# and the Revolut signature block.

import re
import sys
import fitz

# Whichever statement is being replaced. Passed in, because the next one will
# have a different date on it.
SRC = sys.argv[1] if len(sys.argv) > 1 else ""
OUT = sys.argv[2] if len(sys.argv) > 2 else ""
if not SRC or not OUT:
    print("usage: python3 scripts/redact-proof-of-funds.py <statement.pdf> <out.pdf>")
    raise SystemExit(2)

# The labels whose VALUE is redacted. Matched on the label rather than on the
# shape of the value, so the FSCS registration numbers in the page footer
# ("12871051", "981170") are never touched.
LABELS = {
    "account number",
    "sort code",
    "iban",
    "routing number",
    "wire routing number",
}

REPLACEMENT = "hidden for security"

doc = fitz.open(SRC)
redacted = 0

for page in doc:
    words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, wordno
    lines = {}
    for w in words:
        lines.setdefault((w[5], w[6]), []).append(w)

    rows = []
    for key, ws in lines.items():
        ws.sort(key=lambda w: w[7])
        rect = fitz.Rect(ws[0][:4])
        for v in ws[1:]:
            rect |= fitz.Rect(v[:4])
        rows.append({"text": " ".join(w[4] for w in ws).strip(), "rect": rect})

    # THE LABEL AND ITS VALUE ARE NOT ON THE SAME EXTRACTED LINE. Revolut lays
    # this out as two columns of label/value pairs, and the extractor splits
    # each pair at the gap, so "Sort code" and "04-00-75" come back as separate
    # lines that happen to share a row. Matching on the label alone (which the
    # first version did) found nothing at all and quietly redacted zero values.
    # They are paired here by vertical overlap instead: same row, to the right,
    # and close enough that the other column cannot be picked up.
    targets = []
    for row in rows:
        if row["text"].strip().lower() not in LABELS:
            continue
        lab = row["rect"]
        mid = (lab.y0 + lab.y1) / 2
        for other in rows:
            r = other["rect"]
            if r == lab:
                continue
            if not (r.y0 - 1 <= mid <= r.y1 + 1):
                continue
            if r.x0 <= lab.x1:
                continue
            if r.x0 - lab.x0 > 250:   # the far column is ~252pt away
                continue
            targets.append(r)

    for rect in targets:
        # White fill, not black: the document still has to read as a bank
        # statement an agent will accept, not as a leaked file.
        page.add_redact_annot(rect, fill=(1, 1, 1))
        redacted += 1
    page.apply_redactions()

    # Then say WHY it is blank. A silent gap reads as a broken PDF; the words
    # tell the agent this was done on purpose.
    for rect in targets:
        page.insert_text(
            (rect.x0, rect.y1 - 1),
            REPLACEMENT,
            fontsize=7.5,
            color=(0.55, 0.55, 0.58),
            fontname="helv",
        )

pages = len(doc)
doc.save(OUT, garbage=4, deflate=True, clean=True)
doc.close()

# PROVE IT. Re-open the saved file and look for anything that still reads like
# a sort code, an IBAN or an account number. A redaction nobody verified is a
# redaction that has not happened.
check = fitz.open(OUT)
full = "\n".join(p.get_text() for p in check)
check.close()

leaks = []
if re.search(r"\b\d{2}-\d{2}-\d{2}\b", full):
    leaks.append("a sort code")
if re.search(r"\bGB\d{2}\s*[A-Z]{4}", full):
    leaks.append("an IBAN")
# Account numbers are 8 digits. The FSCS footer numbers are legitimately there,
# so they are excluded by name rather than by shape.
stripped = full.replace("12871051", "").replace("13806307", "").replace("981170", "")
if re.search(r"\b\d{8}\b", stripped):
    leaks.append("an 8-digit account number")

print(f"redacted {redacted} values across {pages} pages -> {OUT}")
if leaks:
    print("LEAK, do not use this file:", ", ".join(leaks))
    sys.exit(1)
print("verified: no sort code, IBAN or account number survives in the text layer")
print("still present:", "balances" if "£" in full else "NO BALANCES, something went wrong")
print("company present:", "AIRBRICK FINANCE LTD" in full)
