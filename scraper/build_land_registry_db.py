"""Build local SQLite database from Land Registry Price Paid CSV files.

Downloads are from: http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/
CSV format (no header): https://www.gov.uk/guidance/about-the-price-paid-data#explanations-of-column-headers-in-the-ppd

Columns:
  0: Transaction ID
  1: Price
  2: Date of Transfer (YYYY-MM-DD HH:MM)
  3: Postcode
  4: Property Type (D=Detached, S=Semi, T=Terraced, F=Flat, O=Other)
  5: Old/New (Y=New build, N=Established)
  6: Duration (F=Freehold, L=Leasehold)
  7: PAON (Primary addressable object name — house number/name)
  8: SAON (Secondary addressable object name — flat number)
  9: Street
  10: Locality
  11: Town/City
  12: District
  13: County
  14: PPD Category (A=Standard, B=Additional)
  15: Record Status (A=Addition, C=Change, D=Deletion)

Usage:
  python build_land_registry_db.py
"""
import sqlite3, csv, glob, os, time
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data" / "land_registry"
DB_PATH = Path(__file__).parent / "data" / "land_registry.db"

PROPERTY_TYPES = {
    "D": "detached",
    "S": "semi-detached",
    "T": "terraced",
    "F": "flat",
    "O": "other",
}


def build_db():
    csv_files = sorted(glob.glob(str(DATA_DIR / "pp-*.csv")))
    if not csv_files:
        print(f"No CSV files found in {DATA_DIR}")
        return

    print(f"Found {len(csv_files)} CSV files")
    print(f"Building database at {DB_PATH}")

    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-200000")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS sold_prices (
            id TEXT PRIMARY KEY,
            price INTEGER NOT NULL,
            date TEXT NOT NULL,
            postcode TEXT NOT NULL,
            property_type TEXT NOT NULL,
            new_build INTEGER NOT NULL DEFAULT 0,
            tenure TEXT NOT NULL DEFAULT '',
            paon TEXT NOT NULL DEFAULT '',
            saon TEXT NOT NULL DEFAULT '',
            street TEXT NOT NULL DEFAULT '',
            locality TEXT NOT NULL DEFAULT '',
            town TEXT NOT NULL DEFAULT '',
            district TEXT NOT NULL DEFAULT '',
            county TEXT NOT NULL DEFAULT ''
        )
    """)

    conn.execute("CREATE INDEX IF NOT EXISTS idx_postcode ON sold_prices(postcode)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_postcode_type ON sold_prices(postcode, property_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON sold_prices(date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_street ON sold_prices(street)")

    total = 0
    for csv_file in csv_files:
        fname = os.path.basename(csv_file)
        count = 0
        start = time.time()
        print(f"  Processing {fname}...", end=" ", flush=True)

        with open(csv_file, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f)
            batch = []
            for row in reader:
                if len(row) < 15:
                    continue
                if row[15].strip('"') == "D":
                    continue

                txn_id = row[0].strip('" {}')
                price = int(row[1].strip('"'))
                date = row[2].strip('"')[:10]
                postcode = row[3].strip('" ').upper().replace("  ", " ")
                ptype = PROPERTY_TYPES.get(row[4].strip('"'), row[4].strip('"'))
                new_build = 1 if row[5].strip('"') == "Y" else 0
                tenure = row[6].strip('"')
                paon = row[7].strip('"')
                saon = row[8].strip('"')
                street = row[9].strip('"')
                locality = row[10].strip('"')
                town = row[11].strip('"')
                district = row[12].strip('"')
                county = row[13].strip('"')

                batch.append((
                    txn_id, price, date, postcode, ptype, new_build, tenure,
                    paon, saon, street, locality, town, district, county
                ))
                count += 1

                if len(batch) >= 50000:
                    conn.executemany(
                        "INSERT OR IGNORE INTO sold_prices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        batch)
                    conn.commit()
                    batch = []

            if batch:
                conn.executemany(
                    "INSERT OR IGNORE INTO sold_prices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    batch)
                conn.commit()

        elapsed = time.time() - start
        total += count
        print(f"{count:,} rows ({elapsed:.1f}s)")

    conn.execute("ANALYZE")
    conn.commit()

    db_size = DB_PATH.stat().st_size / (1024 * 1024)
    print(f"\nDone! {total:,} total rows, database size: {db_size:.1f} MB")

    flat_count = conn.execute(
        "SELECT COUNT(*) FROM sold_prices WHERE property_type='flat' AND date >= '2022-01-01'"
    ).fetchone()[0]
    print(f"Flats sold since 2022: {flat_count:,}")

    b42_count = conn.execute(
        "SELECT COUNT(*) FROM sold_prices WHERE postcode LIKE 'B42%' AND property_type='flat'"
    ).fetchone()[0]
    print(f"Flats in B42 (all time): {b42_count:,}")

    conn.close()


if __name__ == "__main__":
    build_db()
