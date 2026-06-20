"""
seed.py — Populate the database with realistic fake data.

Run this once after database.py to get a working hospital you can query.
Safe to re-run: it clears old seed data first so you don't get duplicates.

  python database.py   # create the schema
  python seed.py       # fill it with fake data
"""

import random
import sqlite3
from database import create_schema, get_connection
from faker import Faker

fake = Faker()

# ------------------------------------------------------------------ #
# Reference data used to generate realistic-looking records.         #
# ------------------------------------------------------------------ #

BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]

SPECIALTIES = [
    "Cardiothoracic Surgery",
    "Transplant Surgery",
    "Pulmonology",
    "Anesthesiology",
]

# Substances that will appear in allergy records.
ALLERGY_SUBSTANCES = [
    "Penicillin", "Aspirin", "Ibuprofen", "Sulfa drugs",
    "Codeine", "Latex", "Morphine", "Amoxicillin", "Cephalosporins",
]

SEVERITIES   = ["mild", "moderate", "severe"]
REACTIONS    = ["rash", "anaphylaxis", "hives", "nausea", "respiratory distress", "swelling"]
FREQUENCIES  = ["once daily", "twice daily", "three times daily", "every 8 hours", "as needed"]

# (name, category, typical_dosage, notes)
MEDICATIONS = [
    ("Metformin",      "Antidiabetic",        "500mg",   "Take with food"),
    ("Lisinopril",     "ACE Inhibitor",       "10mg",    "Monitor blood pressure"),
    ("Atorvastatin",   "Statin",              "20mg",    "Take in the evening"),
    ("Amoxicillin",    "Antibiotic",          "500mg",   "Complete full course"),
    ("Warfarin",       "Anticoagulant",       "5mg",     "Regular INR monitoring required"),
    ("Cyclosporine",   "Immunosuppressant",   "100mg",   "Transplant patients — do not skip doses"),
    ("Prednisone",     "Corticosteroid",      "20mg",    "Taper dose; do not stop abruptly"),
    ("Tacrolimus",     "Immunosuppressant",   "1mg",     "Monitor trough levels"),
    ("Furosemide",     "Diuretic",            "40mg",    "Monitor electrolytes"),
    ("Omeprazole",     "Proton Pump Inhibitor","20mg",   "Take 30 min before meals"),
    ("Amlodipine",     "Calcium Channel Blocker","5mg",  "May cause ankle swelling"),
    ("Metoprolol",     "Beta Blocker",        "50mg",    "Do not stop abruptly"),
]


# ------------------------------------------------------------------ #
# Individual seeder functions — one per table.                        #
# Each returns the number of rows inserted so we can print a summary. #
# ------------------------------------------------------------------ #

def seed_surgeons(conn: sqlite3.Connection, n: int = 6) -> int:
    """
    Insert n fake surgeons.
    slack_user_id format mirrors real Slack IDs (e.g. U01AB2CD3EF).
    """
    rows = [
        (
            fake.name(),
            fake.unique.email(),
            random.choice(SPECIALTIES),
            # bothify replaces ? with letters and # with digits
            f"U{fake.bothify('??#####??').upper()}",
        )
        for _ in range(n)
    ]
    conn.executemany(
        "INSERT INTO surgeons (name, email, specialty, slack_user_id) VALUES (?, ?, ?, ?)",
        rows,
    )
    return n


def seed_patients(conn: sqlite3.Connection, n: int = 30) -> int:
    """
    Insert n fake patients.
    medical_record_number is unique across patients.
    """
    rows = [
        (
            fake.name(),
            fake.date_of_birth(minimum_age=18, maximum_age=80).isoformat(),
            random.choice(BLOOD_TYPES),
            fake.unique.bothify("MRN-######"),
        )
        for _ in range(n)
    ]
    conn.executemany(
        "INSERT INTO patients (name, date_of_birth, blood_type, medical_record_number) "
        "VALUES (?, ?, ?, ?)",
        rows,
    )
    return n


def seed_medications(conn: sqlite3.Connection) -> int:
    """
    Insert the fixed medication list.
    INSERT OR IGNORE skips a row if the name already exists (UNIQUE constraint).
    """
    conn.executemany(
        "INSERT OR IGNORE INTO medications (name, category, typical_dosage, notes) "
        "VALUES (?, ?, ?, ?)",
        MEDICATIONS,
    )
    return len(MEDICATIONS)


def seed_allergies(conn: sqlite3.Connection) -> int:
    """
    Give each patient 0–3 allergies, chosen randomly.
    random.sample picks k items without repetition — so no duplicate substances.
    """
    patient_ids = [row["id"] for row in conn.execute("SELECT id FROM patients").fetchall()]

    rows = []
    for pid in patient_ids:
        # randint(0, 3) — patient might have zero allergies
        substances = random.sample(ALLERGY_SUBSTANCES, k=random.randint(0, 3))
        for substance in substances:
            rows.append((pid, substance, random.choice(SEVERITIES), random.choice(REACTIONS)))

    conn.executemany(
        "INSERT INTO allergies (patient_id, substance, severity, reaction) VALUES (?, ?, ?, ?)",
        rows,
    )
    return len(rows)


def seed_prescriptions(conn: sqlite3.Connection) -> int:
    """
    Give each patient 1–4 prescriptions from random surgeons.
    Weighted so ~75% are 'active' (mirrors a real hospital population).
    """
    patient_ids    = [r["id"] for r in conn.execute("SELECT id FROM patients").fetchall()]
    surgeon_ids    = [r["id"] for r in conn.execute("SELECT id FROM surgeons").fetchall()]
    medication_ids = [r["id"] for r in conn.execute("SELECT id FROM medications").fetchall()]

    # Weighted statuses: active appears 3× more than completed, cancelled is rare
    statuses = ["active"] * 6 + ["completed"] * 3 + ["cancelled"] * 1

    rows = []
    for pid in patient_ids:
        for _ in range(random.randint(1, 4)):
            start = fake.date_between(start_date="-2y", end_date="-1m")

            # Active prescriptions have no end date; others do
            status   = random.choice(statuses)
            end_date = (
                None
                if status == "active"
                else fake.date_between(start_date=start, end_date="today").isoformat()
            )

            rows.append((
                pid,
                random.choice(medication_ids),
                random.choice(surgeon_ids),
                f"{random.choice([5, 10, 20, 50, 100, 250, 500])}mg",
                random.choice(FREQUENCIES),
                start.isoformat(),
                end_date,
                status,
            ))

    conn.executemany(
        """
        INSERT INTO prescriptions
            (patient_id, medication_id, surgeon_id, dosage, frequency,
             start_date, end_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


# ------------------------------------------------------------------ #
# Main runner                                                          #
# ------------------------------------------------------------------ #

def clear_data(conn: sqlite3.Connection) -> None:
    """
    Wipe all seed data so re-running this script starts fresh.
    Order matters — delete child tables before parents (foreign keys).
    """
    for table in ["audit_log", "prescriptions", "allergies", "patients", "medications", "surgeons"]:
        conn.execute(f"DELETE FROM {table}")


def run() -> None:
    # 1. Make sure the schema exists (safe if already created)
    create_schema()

    with get_connection() as conn:
        # 2. Clear previous seed data
        clear_data(conn)

        # 3. Seed each table and collect counts for the summary
        counts = {
            "surgeons":      seed_surgeons(conn),
            "patients":      seed_patients(conn),
            "medications":   seed_medications(conn),
            "allergies":     seed_allergies(conn),
            "prescriptions": seed_prescriptions(conn),
        }

    # 4. Print a summary
    print("\n✓ Seed complete:")
    for table, count in counts.items():
        print(f"  {table:<15} {count:>4} rows")

    print("\nVerify with:")
    print("  python verify.py")


if __name__ == "__main__":
    run()