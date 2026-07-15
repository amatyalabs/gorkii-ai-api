"""
seed.py — Populate the database with realistic fake data.

Run this once after database.py to get a working hospital you can query.
Safe to re-run: it clears old seed data first so you don't get duplicates.

  python database.py   # create the schema
  python seed.py       # fill it with fake data
"""

import random
from database import create_schema, get_connection
from faker import Faker

fake = Faker()  # English only for emails, dates, MRNs etc.

# ------------------------------------------------------------------ #
# Nepali names (romanized — readable but authentically Nepali)        #
# ------------------------------------------------------------------ #

NEPALI_FIRST_NAMES = [
    "Ramesh", "Sita", "Bikash", "Anita", "Prakash",
    "Sunita", "Rajesh", "Priya", "Dipak", "Kamala",
    "Narayan", "Gita", "Suresh", "Mina", "Binod",
    "Shanta", "Roshan", "Puja", "Manoj", "Sarita",
    "Anil", "Prabha", "Sanjay", "Nirmala", "Bijay",
    "Rekha", "Nabin", "Sabita", "Santosh", "Kopila",
    "Dinesh", "Durga", "Prabin", "Laxmi", "Ashok",
    "Sushila", "Kamal", "Indira", "Gopal", "Ambika",
    "Deepak", "Mandira", "Rajan", "Chandrika", "Mohan",
    "Pushpa", "Hari", "Radha", "Bhim", "Sharada",
    "Umesh", "Bimala", "Kiran", "Savitri", "Tanka",
    "Yasoda", "Dhan", "Hira", "Tirtha", "Parbati",
]

NEPALI_LAST_NAMES = [
    "Thapa", "Sharma", "Gurung", "Shrestha", "Karki",
    "Rai", "Tamang", "Limbu", "Magar", "Pandey",
    "Adhikari", "Bhandari", "Khadka", "Poudel", "Subedi",
    "Basnet", "KC", "Bhattarai", "Chhetri", "Gautam",
    "Acharya", "Dahal", "Regmi", "Upreti", "Dhakal",
    "Koirala", "Tiwari", "Joshi", "Ghimire", "Parajuli",
    "Aryal", "Sapkota", "Rijal", "Baral", "Pokhrel",
    "Neupane", "Lama", "Budhathoki", "Baniya", "Silwal",
    "Mahato", "Yadav", "Shah", "Raut", "Chaudhary",
    "Sah", "Mandal", "Sinha", "Tharu", "Giri",
]


def nepali_name() -> str:
    return f"{random.choice(NEPALI_FIRST_NAMES)} {random.choice(NEPALI_LAST_NAMES)}"


# ------------------------------------------------------------------ #
# Reference data                                                       #
# ------------------------------------------------------------------ #

BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
GENDERS     = ["Male", "Female"]

SPECIALTIES = [
    "Cardiothoracic Surgery",
    "Transplant Surgery",
    "Pulmonology",
    "Anesthesiology",
]

ALLERGY_SUBSTANCES = [
    "Penicillin", "Aspirin", "Ibuprofen", "Sulfa drugs",
    "Codeine", "Latex", "Morphine", "Amoxicillin", "Cephalosporins",
]

SEVERITIES  = ["mild", "moderate", "severe"]
REACTIONS   = ["rash", "anaphylaxis", "hives", "nausea", "respiratory distress", "swelling"]
FREQUENCIES = ["once daily", "twice daily", "three times daily", "every 8 hours", "as needed"]

MEDICATIONS = [
    ("Metformin",      "Antidiabetic",           "500mg",  "Take with food"),
    ("Lisinopril",     "ACE Inhibitor",           "10mg",   "Monitor blood pressure"),
    ("Atorvastatin",   "Statin",                  "20mg",   "Take in the evening"),
    ("Amoxicillin",    "Antibiotic",              "500mg",  "Complete full course"),
    ("Warfarin",       "Anticoagulant",           "5mg",    "Regular INR monitoring required"),
    ("Cyclosporine",   "Immunosuppressant",       "100mg",  "Transplant patients — do not skip doses"),
    ("Prednisone",     "Corticosteroid",          "20mg",   "Taper dose; do not stop abruptly"),
    ("Tacrolimus",     "Immunosuppressant",       "1mg",    "Monitor trough levels"),
    ("Furosemide",     "Diuretic",                "40mg",   "Monitor electrolytes"),
    ("Omeprazole",     "Proton Pump Inhibitor",   "20mg",   "Take 30 min before meals"),
    ("Amlodipine",     "Calcium Channel Blocker", "5mg",    "May cause ankle swelling"),
    ("Metoprolol",     "Beta Blocker",            "50mg",   "Do not stop abruptly"),
]

# (test_name, unit, ref_low, ref_high)
INVESTIGATION_TEMPLATES = [
    ("Hemoglobin",       "g/dL",   12.0, 17.5),
    ("WBC",              "10^9/L",  4.0, 11.0),
    ("Platelets",        "10^9/L", 150,  400),
    ("Creatinine",       "mg/dL",   0.6,   1.2),
    ("Tacrolimus level", "ng/mL",   5.0,  15.0),
    ("Potassium",        "mEq/L",   3.5,   5.0),
    ("ALT",              "U/L",     7,    56),
    ("Sodium",           "mEq/L",  136,  145),
    ("Urea",             "mg/dL",  15,    45),
    ("Cyclosporine level","ng/mL", 100,  400),
]


# ------------------------------------------------------------------ #
# Seeders                                                              #
# ------------------------------------------------------------------ #

def seed_surgeons(conn, n: int = 8) -> int:
    """Insert n surgeons with Nepali names."""
    rows = [
        (
            nepali_name(),
            fake.unique.email(),
            random.choice(SPECIALTIES),
        )
        for _ in range(n)
    ]
    cur = conn.cursor()
    cur.executemany(
        "INSERT INTO surgeons (name, email, specialty) VALUES (%s, %s, %s)",
        rows,
    )
    return n


def seed_patients(conn, n: int = 30) -> int:
    """Insert n patients with Nepali names and gender."""
    rows = [
        (
            nepali_name(),
            fake.date_of_birth(minimum_age=18, maximum_age=80).isoformat(),
            random.choice(BLOOD_TYPES),
            random.choice(GENDERS),
            fake.unique.bothify("MRN-######"),
        )
        for _ in range(n)
    ]
    cur = conn.cursor()
    cur.executemany(
        "INSERT INTO patients (name, date_of_birth, blood_type, gender, medical_record_number) "
        "VALUES (%s, %s, %s, %s, %s)",
        rows,
    )
    return n


def seed_medications(conn) -> int:
    cur = conn.cursor()
    # ON CONFLICT DO NOTHING replaces sqlite3's "INSERT OR IGNORE" — relies
    # on the UNIQUE constraint already on medications.name.
    cur.executemany(
        "INSERT INTO medications (name, category, typical_dosage, notes) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT (name) DO NOTHING",
        MEDICATIONS,
    )
    return len(MEDICATIONS)


def seed_allergies(conn) -> int:
    cur = conn.cursor()
    cur.execute("SELECT id FROM patients")
    patient_ids = [row["id"] for row in cur.fetchall()]
    rows = []
    for pid in patient_ids:
        substances = random.sample(ALLERGY_SUBSTANCES, k=random.randint(0, 3))
        for substance in substances:
            rows.append((pid, substance, random.choice(SEVERITIES), random.choice(REACTIONS)))
    cur.executemany(
        "INSERT INTO allergies (patient_id, substance, severity, reaction) VALUES (%s, %s, %s, %s)",
        rows,
    )
    return len(rows)


def seed_prescriptions(conn) -> int:
    cur = conn.cursor()
    cur.execute("SELECT id FROM patients")
    patient_ids = [r["id"] for r in cur.fetchall()]
    cur.execute("SELECT id FROM surgeons")
    surgeon_ids = [r["id"] for r in cur.fetchall()]
    cur.execute("SELECT id FROM medications")
    medication_ids = [r["id"] for r in cur.fetchall()]

    statuses = ["active"] * 6 + ["completed"] * 3 + ["cancelled"] * 1
    rows = []
    for pid in patient_ids:
        for _ in range(random.randint(1, 4)):
            start  = fake.date_between(start_date="-2y", end_date="-1m")
            status = random.choice(statuses)
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
    cur.executemany(
        """INSERT INTO prescriptions
               (patient_id, medication_id, surgeon_id, dosage, frequency,
                start_date, end_date, status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        rows,
    )
    return len(rows)


def seed_vitals(conn) -> int:
    """
    Give each patient 2-3 vital sign readings at different timestamps.
    Values are realistic for a post-surgical/transplant population.
    """
    cur = conn.cursor()
    cur.execute("SELECT id FROM patients")
    patient_ids = [r["id"] for r in cur.fetchall()]
    cur.execute("SELECT id FROM surgeons")
    surgeon_ids = [r["id"] for r in cur.fetchall()]

    rows = []
    for pid in patient_ids:
        for _ in range(random.randint(2, 3)):
            recorded_at = fake.date_time_between(
                start_date="-6m", end_date="now"
            ).isoformat()
            rows.append((
                pid,
                random.choice(surgeon_ids),
                recorded_at,
                round(random.uniform(50.0, 95.0), 1),    # weight_kg
                round(random.uniform(150.0, 185.0), 1),  # height_cm
                round(random.uniform(94.0, 99.0), 1),    # o2_saturation
                round(random.uniform(36.5, 37.8), 1),    # temperature_celsius
                random.randint(110, 145),                 # blood_pressure_systolic
                random.randint(70, 95),                   # blood_pressure_diastolic
                random.randint(58, 95),                   # heart_rate
                random.randint(12, 20),                   # respiration_rate
                None,                                     # notes
            ))
    cur.executemany(
        """INSERT INTO patient_vitals
               (patient_id, recorded_by, recorded_at,
                weight_kg, height_cm, o2_saturation, temperature_celsius,
                blood_pressure_systolic, blood_pressure_diastolic,
                heart_rate, respiration_rate, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        rows,
    )
    return len(rows)


def seed_investigations(conn) -> int:
    """
    Give each patient 3-5 lab results using clinically relevant tests.
    ~25% of values are flagged abnormal to give the agent real data to surface.
    Tacrolimus and Cyclosporine levels are especially relevant for transplant patients.
    """
    cur = conn.cursor()
    cur.execute("SELECT id FROM patients")
    patient_ids = [r["id"] for r in cur.fetchall()]

    rows = []
    for pid in patient_ids:
        tests = random.sample(INVESTIGATION_TEMPLATES, k=random.randint(3, 5))
        for test_name, unit, ref_low, ref_high in tests:
            if random.random() < 0.25:
                # abnormal value — outside reference range
                if random.random() < 0.5:
                    value = round(random.uniform(ref_low * 0.6, ref_low * 0.95), 2)
                else:
                    value = round(random.uniform(ref_high * 1.05, ref_high * 1.4), 2)
                is_abnormal = 1
            else:
                value = round(random.uniform(ref_low, ref_high), 2)
                is_abnormal = 0

            tested_at = fake.date_time_between(
                start_date="-3m", end_date="now"
            ).isoformat()

            rows.append((
                pid,
                test_name,
                str(value),
                unit,
                f"{ref_low}-{ref_high}",
                is_abnormal,
                tested_at,
                None,
            ))
    cur.executemany(
        """INSERT INTO investigation_log
               (patient_id, test_name, test_value, unit,
                reference_range, is_abnormal, tested_at, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        rows,
    )
    return len(rows)


# ------------------------------------------------------------------ #
# Gita Limbu — a fixed, permanent demo patient (not randomly          #
# generated). Real identity pulled from the pre-migration SQLite      #
# database; her allergy/medication profile is curated rather than     #
# the messy duplicate-riddled history that had piled up from manual   #
# testing, so demos (allergy conflicts, drug interactions) are        #
# reliable and reproducible across every reseed. No vitals,           #
# investigation_log, or patient_documents rows by design.             #
# ------------------------------------------------------------------ #

GITA_LIMBU = {
    "name": "Gita Limbu",
    "date_of_birth": "1975-12-01",
    "blood_type": "A-",
    "gender": "Female",
    "medical_record_number": "MRN-147608",
}

GITA_ALLERGIES = [
    # (substance, severity, reaction)
    ("Penicillin", "severe", "respiratory distress"),
    ("Latex", "mild", "swelling"),
    ("Aspirin", "moderate", "hives"),
]

GITA_MEDICATIONS = [
    # (medication_name, dosage, frequency, start_date) — both currently active
    ("Cyclosporine", "20mg", "three times a week", "2026-07-20"),
    ("Amlodipine", "50mg", "once daily", "2025-10-20"),
]


def seed_gita_limbu(conn) -> int:
    """
    Insert Gita Limbu with a fixed identity and a curated allergy/medication
    profile. Called after the random seeders in run() so she isn't part of
    the pool those seeders generate vitals/investigation_log data for.
    """
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO patients (name, date_of_birth, blood_type, gender, medical_record_number) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (
            GITA_LIMBU["name"],
            GITA_LIMBU["date_of_birth"],
            GITA_LIMBU["blood_type"],
            GITA_LIMBU["gender"],
            GITA_LIMBU["medical_record_number"],
        ),
    )
    patient_id = cur.fetchone()["id"]

    cur.executemany(
        "INSERT INTO allergies (patient_id, substance, severity, reaction) VALUES (%s, %s, %s, %s)",
        [(patient_id, substance, severity, reaction) for substance, severity, reaction in GITA_ALLERGIES],
    )

    cur.execute("SELECT id FROM surgeons ORDER BY random() LIMIT 1")
    surgeon_id = cur.fetchone()["id"]

    for med_name, dosage, frequency, start_date in GITA_MEDICATIONS:
        cur.execute("SELECT id FROM medications WHERE name = %s", (med_name,))
        med_row = cur.fetchone()
        if med_row is None:
            continue
        cur.execute(
            """INSERT INTO prescriptions
                   (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, status)
               VALUES (%s, %s, %s, %s, %s, %s, 'active')""",
            (patient_id, med_row["id"], surgeon_id, dosage, frequency, start_date),
        )

    return patient_id


# ------------------------------------------------------------------ #
# Main runner                                                          #
# ------------------------------------------------------------------ #

def clear_data(conn) -> None:
    """
    Wipe all seed data. Order matters — delete child tables before parents.
    """
    cur = conn.cursor()
    for table in [
        "audit_log", "patient_documents", "investigation_log",
        "patient_vitals", "pending_approvals", "prescriptions",
        "allergies", "patients", "medications", "surgeons",
    ]:
        cur.execute(f"DELETE FROM {table}")


def run() -> None:
    create_schema()

    with get_connection() as conn:
        clear_data(conn)

        counts = {
            "surgeons":          seed_surgeons(conn),
            "patients":          seed_patients(conn),
            "medications":       seed_medications(conn),
            "allergies":         seed_allergies(conn),
            "prescriptions":     seed_prescriptions(conn),
            "patient_vitals":    seed_vitals(conn),
            "investigation_log": seed_investigations(conn),
        }

        # Fixed patient — inserted after everything above, so she's not part
        # of the random pool those seeders generated data for. She gets her
        # own curated allergies/prescriptions from seed_gita_limbu, but no
        # vitals, investigation_log, or patient_documents rows.
        seed_gita_limbu(conn)
        counts["patients"] += 1
        counts["gita_limbu"] = 1

    print("\n✓ Seed complete:")
    for table, count in counts.items():
        print(f"  {table:<20} {count:>4} rows")

    print("\nVerify with:")
    print("  python verify.py")


if __name__ == "__main__":
    run()
