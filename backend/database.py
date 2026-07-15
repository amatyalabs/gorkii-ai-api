"""
database.py — Connection management and schema creation (Postgres).

Java analogy for this whole file:
  get_connection()  =  opening a JDBC Connection (try-with-resources)
  create_schema()   =  running your Flyway/Liquibase migrations
  RealDictCursor    =  a Map<String, Object> that also supports row["column_name"]
"""

import os
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# SQLite never needed an env var, so this file never had to load .env itself —
# other modules (client.py, web.py) did it as a side effect of import. Postgres
# needs DATABASE_URL, so this file must be self-sufficient regardless of which
# module imports it first (e.g. `python database.py`, or seed.py/verify.py,
# neither of which imports client.py).
load_dotenv()

# Full connection string, e.g. postgresql://user:password@host:5432/dbname
DATABASE_URL = os.getenv("DATABASE_URL")


@contextmanager
def get_connection():
    """
    Open a connection to Postgres and yield it inside a `with` block —
    that's Python's try-with-resources. On a clean exit it commits; on an
    exception it rolls back; either way the connection is always closed
    afterward.

    Closing matters much more here than it did for SQLite: a Postgres
    connection is a real TCP connection held server-side, and the rest of
    this codebase opens a fresh one per function call — leaving them open
    would exhaust Postgres's connection limit under real traffic. SQLite's
    file-based connections never had that failure mode.

    cursor_factory=RealDictCursor makes every row behave like a dict —
    row["patient_id"] instead of row[0] — same as sqlite3.Row before.
    """
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def create_schema() -> None:
    """
    Create all tables if they don't already exist.
    Safe to call multiple times — IF NOT EXISTS makes it idempotent.
    """
    sql = """
        -- ------------------------------------------------------------------ --
        -- SURGEONS
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS surgeons (
            id            SERIAL  PRIMARY KEY,
            name          TEXT    NOT NULL,
            email         TEXT    NOT NULL UNIQUE,
            specialty     TEXT    NOT NULL
        );

        -- ------------------------------------------------------------------ --
        -- PATIENTS  (synthetic / fake data only during development)
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS patients (
            id                    SERIAL  PRIMARY KEY,
            name                  TEXT    NOT NULL,
            date_of_birth         TEXT    NOT NULL,   -- stored as ISO-8601: "1985-04-23"
            blood_type            TEXT,
            gender                TEXT,
            medical_record_number TEXT    NOT NULL UNIQUE
        );

        -- ------------------------------------------------------------------ --
        -- ALLERGIES
        -- Linked to patients via foreign key.
        -- severity is constrained to three values — the DB enforces this,
        -- not just your application code.
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS allergies (
            id         SERIAL  PRIMARY KEY,
            patient_id INTEGER NOT NULL REFERENCES patients(id),
            substance  TEXT    NOT NULL,
            severity   TEXT    NOT NULL CHECK(severity IN ('mild', 'moderate', 'severe')),
            reaction   TEXT
        );

        -- ------------------------------------------------------------------ --
        -- MEDICATIONS  (a reference / lookup table)
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS medications (
            id              SERIAL  PRIMARY KEY,
            name            TEXT    NOT NULL UNIQUE,
            category        TEXT    NOT NULL,
            typical_dosage  TEXT,
            notes           TEXT
        );

        -- ------------------------------------------------------------------ --
        -- PRESCRIPTIONS
        -- Links a patient, a medication, and the prescribing surgeon together.
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS prescriptions (
            id            SERIAL  PRIMARY KEY,
            patient_id    INTEGER NOT NULL REFERENCES patients(id),
            medication_id INTEGER NOT NULL REFERENCES medications(id),
            surgeon_id    INTEGER NOT NULL REFERENCES surgeons(id),
            dosage        TEXT    NOT NULL,
            frequency     TEXT    NOT NULL,
            start_date    TEXT    NOT NULL,
            end_date      TEXT,                        -- NULL means ongoing
            status        TEXT    NOT NULL DEFAULT 'active'
                          CHECK(status IN ('active', 'completed', 'cancelled'))
        );

        -- ------------------------------------------------------------------ --
        -- AUDIT LOG  — append-only.  Never UPDATE or DELETE rows here.
        -- Every action the agent takes or proposes is recorded here.
        -- This is your compliance record AND your debugging tool.
        --
        -- action_payload stores JSON (the full context sent to the LLM,
        -- the proposed action text, etc.) so you can replay any decision.
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS audit_log (
            id             SERIAL  PRIMARY KEY,
            timestamp      TEXT    NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            surgeon_id     INTEGER REFERENCES surgeons(id),
            patient_id     INTEGER REFERENCES patients(id),
            action_type    TEXT    NOT NULL,
            action_payload TEXT,                       -- JSON blob
            decision       TEXT    NOT NULL
                           CHECK(decision IN ('safe', 'needs_approval', 'approved', 'rejected')),
            approved_by    INTEGER REFERENCES surgeons(id)
        );

        CREATE TABLE IF NOT EXISTS pending_approvals (
            id               SERIAL  PRIMARY KEY,
            patient_id       INTEGER REFERENCES patients(id),
            action_type      TEXT NOT NULL,
            action_payload   TEXT NOT NULL,
            description      TEXT NOT NULL,
            approver_id      INTEGER REFERENCES surgeons(id),
            approval_status  TEXT NOT NULL DEFAULT 'pending'
                            CHECK(approval_status IN ('pending', 'approved', 'rejected')),
            created_at       TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            expires_at       TEXT
        );

        CREATE TABLE IF NOT EXISTS patient_documents (
            id               SERIAL  PRIMARY KEY,
            patient_id       INTEGER REFERENCES patients(id),
            document_type    TEXT NOT NULL,
            summary          TEXT NOT NULL,
            file_path        TEXT,
            surgeon_notes    TEXT,
            uploaded_by      INTEGER REFERENCES surgeons(id),
            created_at       TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

        CREATE TABLE IF NOT EXISTS patient_vitals (
            id                          SERIAL  PRIMARY KEY,
            patient_id                  INTEGER REFERENCES patients(id),
            recorded_by                 INTEGER REFERENCES surgeons(id),
            recorded_at                 TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            weight_kg                   REAL,
            height_cm                   REAL,
            o2_saturation               REAL,
            temperature_celsius         REAL,
            blood_pressure_systolic     INTEGER,
            blood_pressure_diastolic    INTEGER,
            heart_rate                  INTEGER,
            respiration_rate            INTEGER,
            notes                       TEXT
        );

        CREATE TABLE IF NOT EXISTS investigation_log (
            id                  SERIAL  PRIMARY KEY,
            patient_id          INTEGER REFERENCES patients(id),
            test_name           TEXT NOT NULL,
            test_value          TEXT NOT NULL,
            unit                TEXT,
            reference_range     TEXT,
            is_abnormal         INTEGER,
            tested_at           TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            notes               TEXT
        );
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql)

    host = DATABASE_URL.split("@")[-1] if DATABASE_URL else "DATABASE_URL not set"
    print(f"Schema ready on Postgres ({host})")


# ----------------------------------------------------------------------- #
# This block only runs when you execute  `python database.py`  directly.  #
# It does NOT run when another file does  `from database import ...`       #
# Java equivalent: the  public static void main(String[] args)  guard.    #
# ----------------------------------------------------------------------- #
if __name__ == "__main__":
    create_schema()
