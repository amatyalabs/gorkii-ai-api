"""
verify.py — Quick sanity checks after seeding.

Run this to confirm the database looks right before moving to Phase 1:
  python verify.py

This also teaches you the query patterns you'll use in Phase 1's tool functions.
"""

from database import get_connection


def check(label: str, sql: str) -> None:
    """Run a query and print the first 5 rows under a labelled header."""
    print(f"\n{'─' * 55}")
    print(f"  {label}")
    print(f"{'─' * 55}")
    with get_connection() as conn:
        rows = conn.execute(sql).fetchall()
        if not rows:
            print("  (no rows)")
            return
        # sqlite3.Row supports keys() — like Map.keySet() in Java
        headers = rows[0].keys()
        print("  " + " | ".join(f"{h:<20}" for h in headers))
        print("  " + "-+-".join("-" * 20 for _ in headers))
        for row in rows[:5]:
            print("  " + " | ".join(f"{str(row[h]):<20}" for h in headers))
        if len(rows) > 5:
            print(f"  ... and {len(rows) - 5} more rows")


def run_counts() -> None:
    tables = ["surgeons", "patients", "allergies", "medications", "prescriptions", "audit_log"]
    print("\n╔══════════════════════════════╗")
    print("║     Table Row Counts          ║")
    print("╚══════════════════════════════╝")
    with get_connection() as conn:
        for table in tables:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            bar = "█" * min(count, 40)
            print(f"  {table:<15} {count:>4}  {bar}")


def run_spot_checks() -> None:
    # 1. A patient with their allergies joined in
    check(
        "Sample patient + allergies (JOIN)",
        """
        SELECT p.name, p.blood_type, a.substance, a.severity
        FROM   patients p
        JOIN   allergies a ON a.patient_id = p.id
        LIMIT  8
        """,
    )

    # 2. Active prescriptions with drug name and surgeon
    check(
        "Active prescriptions with drug + surgeon",
        """
        SELECT p.name AS patient, m.name AS drug,
               rx.dosage, rx.frequency, s.name AS surgeon
        FROM   prescriptions rx
        JOIN   patients   p ON p.id = rx.patient_id
        JOIN   medications m ON m.id = rx.medication_id
        JOIN   surgeons   s ON s.id = rx.surgeon_id
        WHERE  rx.status = 'active'
        LIMIT  5
        """,
    )

    # 3. The safety-critical query: patients allergic to a drug we might prescribe.
    # This exact query is the foundation of Phase 1's allergy-check tool.
    check(
        "Patients allergic to Penicillin (safety-critical query)",
        """
        SELECT p.name, p.medical_record_number, a.severity, a.reaction
        FROM   patients p
        JOIN   allergies a ON a.patient_id = p.id
        WHERE  a.substance = 'Penicillin'
        """,
    )

    # 4. Surgeons and their Slack IDs (needed for Phase 4 approval routing)
    check(
        "Surgeons + Slack IDs",
        "SELECT name, specialty, slack_user_id FROM surgeons",
    )


if __name__ == "__main__":
    run_counts()
    run_spot_checks()
    print("\n✓ Database looks good. Ready for Phase 1.\n")