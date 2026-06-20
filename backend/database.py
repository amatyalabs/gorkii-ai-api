"""
database.py — Connection management and schema creation.

Java analogy for this whole file:
  get_connection()  =  opening a JDBC Connection
  create_schema()   =  running your Flyway/Liquibase migrations
  sqlite3.Row       =  a Map<String, Object> that also supports row["column_name"]
"""

import sqlite3
from pathlib import Path

# Path(__file__) is the path of THIS file.
# .parent gives us the folder it lives in.
# So DB_PATH always points to hospital.db in the same folder, no matter where
# you run the script from.  Java equivalent: Paths.get(getClass().getResource("").toURI())
DB_PATH = Path(__file__).parent / "hospital.db"


def get_connection() -> sqlite3.Connection:
    """
    Open and return a connection to the SQLite database.
    Always use this inside a  `with get_connection() as conn:`  block —
    that's Python's try-with-resources.  On exit it auto-commits or rolls back.
    """
    conn = sqlite3.connect(DB_PATH)

    # row_factory makes every row behave like a dict:
    #   row["patient_id"]  instead of  row[0]
    # Much safer — column order changes won't silently break your code.
    conn.row_factory = sqlite3.Row

    # Enforce foreign-key constraints (SQLite skips them by default).
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_schema() -> None:
    """
    Create all tables if they don't already exist.
    Safe to call multiple times — IF NOT EXISTS makes it idempotent.
    Java equivalent: a Flyway migration that only runs once.
    """
    sql = """
        -- ------------------------------------------------------------------ --
        -- SURGEONS
        -- The humans who will use the Slack bot.
        -- slack_user_id lets us route approval tickets to the right person.
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS surgeons (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            email         TEXT    NOT NULL UNIQUE,
            specialty     TEXT    NOT NULL,
            slack_user_id TEXT
        );

        -- ------------------------------------------------------------------ --
        -- PATIENTS  (synthetic / fake data only during development)
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS patients (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            name                  TEXT    NOT NULL,
            date_of_birth         TEXT    NOT NULL,   -- stored as ISO-8601: "1985-04-23"
            blood_type            TEXT,
            medical_record_number TEXT    NOT NULL UNIQUE
        );

        -- ------------------------------------------------------------------ --
        -- ALLERGIES
        -- Linked to patients via foreign key.
        -- severity is constrained to three values — the DB enforces this,
        -- not just your application code.
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS allergies (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL REFERENCES patients(id),
            substance  TEXT    NOT NULL,
            severity   TEXT    NOT NULL CHECK(severity IN ('mild', 'moderate', 'severe')),
            reaction   TEXT
        );

        -- ------------------------------------------------------------------ --
        -- MEDICATIONS  (a reference / lookup table)
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS medications (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT    NOT NULL UNIQUE,
            category        TEXT    NOT NULL,
            typical_dosage  TEXT,
            notes           TEXT
        );

        -- ------------------------------------------------------------------ --
        -- PRESCRIPTIONS
        -- Links a patient, a medication, and the prescribing surgeon together.
        -- status is weighted toward 'active' in seed data to mirror reality.
        -- ------------------------------------------------------------------ --
        CREATE TABLE IF NOT EXISTS prescriptions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      TEXT    NOT NULL DEFAULT (datetime('now')),
            surgeon_id     INTEGER REFERENCES surgeons(id),
            patient_id     INTEGER REFERENCES patients(id),
            action_type    TEXT    NOT NULL,
            action_payload TEXT,                       -- JSON blob
            decision       TEXT    NOT NULL
                           CHECK(decision IN ('safe', 'needs_approval', 'approved', 'rejected')),
            approved_by    INTEGER REFERENCES surgeons(id)
        );
        
        CREATE TABLE IF NOT EXISTS pending_approvals (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id       INTEGER REFERENCES patients(id),
            action_type      TEXT NOT NULL,
            action_payload   TEXT NOT NULL,
            description      TEXT NOT NULL,      
            approver_id      INTEGER REFERENCES surgeons(id),
            approval_status  TEXT NOT NULL DEFAULT 'pending'
                            CHECK(approval_status IN ('pending', 'approved', 'rejected')),
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at       TEXT
        );
    """

    with get_connection() as conn:
        conn.executescript(sql)

    print(f"Schema ready at: {DB_PATH}")


# ----------------------------------------------------------------------- #
# This block only runs when you execute  `python database.py`  directly.  #
# It does NOT run when another file does  `from database import ...`       #
# Java equivalent: the  public static void main(String[] args)  guard.    #
# ----------------------------------------------------------------------- #
if __name__ == "__main__":
    create_schema()