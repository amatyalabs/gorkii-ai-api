from database import get_connection
from pydantic import BaseModel
from enum import Enum
from state import conversation_histories
from datetime import date
import random
import json

class ProposedAction(BaseModel):
    action_type: str
    writes_to_db: bool
    description: str

class Decision(Enum):
    SAFE = "safe"
    NEEDS_APPROVAL = "needs_approval"
    APPROVED = "approved"
    REJECTED = "rejected"

def get_patient_allergies(patient_id: int) -> list[str]:
    with get_connection() as conn:
        cur = conn.cursor()
        get_allergies_query = """SELECT substance FROM allergies
                                WHERE patient_id = %s;"""
        cur.execute(get_allergies_query, (patient_id,))
        rows = cur.fetchall()
    return [row["substance"] for row in rows]

def get_active_medications(patient_id: int) -> list[str]:
    with get_connection() as conn:
        cur = conn.cursor()
        active_medication_query = """SELECT medications.name FROM medications
       INNER JOIN prescriptions ON prescriptions.medication_id = medications.id
       WHERE prescriptions.patient_id = %s AND prescriptions.status = 'active';"""
        cur.execute(active_medication_query, (patient_id,))
        rows = cur.fetchall()
    return [row["name"] for row in rows]

def classify_action(action: ProposedAction) -> Decision:
    HIGH_RISK_TYPES = {"prescription", "medication_change", "dosage_update"}
    if (action.writes_to_db):
        return Decision.NEEDS_APPROVAL
    if (action.action_type in HIGH_RISK_TYPES):
        return Decision.NEEDS_APPROVAL
    return Decision.SAFE

def find_patient_by_name(name: str) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        # ILIKE, not LIKE — Postgres's LIKE is case-sensitive, unlike
        # SQLite's (which is case-insensitive for ASCII by default). Using
        # plain LIKE here would silently stop matching on case mismatches.
        patient_name_query = """SELECT id, name, date_of_birth, medical_record_number FROM patients WHERE name ILIKE %s;"""
        cur.execute(patient_name_query, (f"%{name}%",))
        rows = cur.fetchall()
    return [dict(row) for row in rows]

def get_audit_log(limit: int = 50) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                a.id,
                a.timestamp,
                a.action_type,
                a.decision,
                p.name AS patient_name,
                s.name AS surgeon_name,
                ab.name AS approved_by_name
            FROM audit_log a
            LEFT JOIN patients p ON p.id = a.patient_id
            LEFT JOIN surgeons s ON s.id = a.surgeon_id
            LEFT JOIN surgeons ab ON ab.id = a.approved_by
            ORDER BY a.timestamp DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
    return [dict(row) for row in rows]

def log_audit_entry(
    action: ProposedAction,
    decision: Decision,
    surgeon_id: int | None = None,
    patient_id: int | None = None,
    approved_by: int | None = None
) -> None:
    payload = json.dumps({"description": action.description, "action_type": action.action_type})
    with get_connection() as conn:
        cur = conn.cursor()
        insert_audit_entry = """INSERT INTO audit_log(action_type, action_payload, decision, surgeon_id, patient_id, approved_by) VALUES (%s, %s, %s, %s, %s, %s);"""
        cur.execute(insert_audit_entry, (action.action_type, payload, decision.value, surgeon_id, patient_id, approved_by))
        conn.commit()

def get_active_prescription(patient_id: int, medication_id: int) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        medication_query = """SELECT id, dosage, frequency FROM prescriptions
WHERE patient_id = %s AND medication_id = %s AND status = 'active';"""
        cur.execute(medication_query, (patient_id, medication_id))
        row = cur.fetchone()
        if row is None:
            return None
        return dict(row)

def update_prescription(
    patient_id: int,
    medication_id: int,
    surgeon_id: int,
    dosage: str,
    frequency: str,
    start_date: str,
    end_date: str | None = None)-> None:
    with get_connection() as conn:
        cur = conn.cursor()
        existing = get_active_prescription(patient_id, medication_id)
        if (existing is None):
            query = """INSERT INTO prescriptions (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, status) VALUES(%s, %s, %s, %s, %s, %s, %s, %s)"""
            cur.execute(query, (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, 'active'))
        else:
            update_query = """UPDATE prescriptions SET status='completed' WHERE id = %s;"""
            cur.execute(update_query, (existing.get("id"),))
            insert_query = """INSERT INTO prescriptions (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, status) VALUES(%s, %s, %s, %s, %s, %s, %s, %s)"""
            cur.execute(insert_query, (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, 'active'))
        conn.commit()


def create_pending_approval(
    action_type: str,
    action_payload: dict,
    description: str,
    approver_id: int,
    patient_id: int | None = None,
    expires_at: str | None = None
) -> int:
    payload = json.dumps(action_payload)
    with get_connection() as conn:
        cur = conn.cursor()
        # RETURNING id replaces sqlite3's cur.lastrowid, which Postgres
        # doesn't have — you ask the INSERT itself to hand back the new id.
        add_pending_approval = """INSERT INTO pending_approvals (action_type, action_payload, description, approver_id, patient_id, expires_at) VALUES(%s, %s, %s, %s, %s, %s) RETURNING id"""
        cur.execute(add_pending_approval, (action_type, payload, description, approver_id, patient_id, expires_at))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return new_id

def resolve_approval(approval_id: int, approval_status: str, channel_id: str) -> None:
    with get_connection() as conn:
        cur = conn.cursor()
        update_approval = """UPDATE pending_approvals SET approval_status = %s WHERE id = %s;"""
        cur.execute(update_approval, (approval_status, approval_id))
        conn.commit()

        # Pull the action once — needed to execute it (if approved) and to
        # audit-log the outcome EITHER way. patient_id lives in the payload,
        # so both branches can populate it for the audit-log join.
        fetch_payload = """SELECT action_type, action_payload, approver_id FROM pending_approvals WHERE id = %s;"""
        cur.execute(fetch_payload, (approval_id,))
        row = cur.fetchone()
        payload_string = row["action_payload"]
        payload_dict = json.loads(payload_string)
        patient_id = payload_dict.get("patient_id")

        if approval_status == "approved":
            payload_dict["surgeon_id"] = row["approver_id"]
            update_prescription(**payload_dict)
            action = ProposedAction(
                action_type=row["action_type"],
                writes_to_db=True,
                description=payload_string
            )
            log_audit_entry(
                action,
                decision=Decision.APPROVED,
                surgeon_id=row["approver_id"],
                patient_id=patient_id,
                approved_by=row["approver_id"],
            )
        elif approval_status == "rejected":
            # Log the rejection too — otherwise the audit trail only ever shows
            # approvals, making every resolved action look approved. No DB write
            # happens; approved_by stays null since nothing was approved.
            action = ProposedAction(
                action_type=row["action_type"],
                writes_to_db=False,
                description=payload_string
            )
            log_audit_entry(
                action,
                decision=Decision.REJECTED,
                surgeon_id=row["approver_id"],
                patient_id=patient_id,
                approved_by=None,
            )

    if channel_id in conversation_histories:
        status_text = "approved and executed" if approval_status == "approved" else "rejected"
        conversation_histories[channel_id].append({
            "role": "user",
            "content": f"[System: Approval ID {approval_id} was {status_text}.]"
        })

def get_pending_approvals(surgeon_id: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        fetch_surgeon_approvals = """SELECT * FROM pending_approvals WHERE approver_id = %s;"""
        cur.execute(fetch_surgeon_approvals, (surgeon_id,))
        rows = cur.fetchall()
        return [dict(row) for row in rows]

def get_medication_by_name(name: str) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        # ILIKE — see the note in find_patient_by_name on why this isn't LIKE.
        medication_name_query = """SELECT * FROM medications WHERE name ILIKE %s;"""
        cur.execute(medication_name_query, (name,))
        row = cur.fetchone()
        if row is None:
            return None
        return dict(row)

def store_document(
    patient_id: int,
    document_type: str,
    summary: str,
    uploaded_by: int,
    file_path: str | None = None,
    surgeon_notes: str | None = None,
) -> int:
    with get_connection() as conn:
        cur = conn.cursor()
        document_information = """INSERT INTO patient_documents (patient_id, document_type, summary, uploaded_by, file_path, surgeon_notes) VALUES(%s, %s, %s, %s, %s, %s) RETURNING id;"""
        cur.execute(document_information, (patient_id, document_type, summary, uploaded_by, file_path, surgeon_notes))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return new_id

def get_patient_documents(patient_id: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.cursor()
        patient_doc_query = """SELECT id, patient_id, document_type, summary, surgeon_notes, uploaded_by, created_at FROM patient_documents WHERE patient_id = %s ORDER BY created_at DESC;"""
        cur.execute(patient_doc_query, (patient_id,))
        rows = cur.fetchall()
    return [dict(row) for row in rows]


def onboard_patient(
    name: str,
    date_of_birth: str | None,
    sex: str | None,
    allergies: list[dict],
    medications: list[dict],
    primary_diagnosis: str | None,
    surgeon_id: int,
) -> int:

    with get_connection() as conn:
        cur = conn.cursor()

        while True:
            mrn = f"MRN-{random.randint(100000, 999999)}"
            cur.execute("SELECT id FROM patients WHERE medical_record_number = %s", (mrn,))
            if cur.fetchone() is None:
                break

        # date_of_birth is NOT NULL in the schema; fall back to a placeholder
        # ISO date when the document gave no age to derive one from.
        dob = date_of_birth or "1900-01-01"

        cur.execute(
            "INSERT INTO patients (name, date_of_birth, gender, medical_record_number) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (name, dob, sex, mrn),
        )
        patient_id = cur.fetchone()["id"]

        # 2. allergies — severity defaults to 'moderate' (see endpoint note)
        for a in allergies:
            cur.execute(
                "INSERT INTO allergies (patient_id, substance, severity, reaction) "
                "VALUES (%s, %s, %s, %s)",
                (patient_id, a["name"], a.get("severity") or "moderate", None),
            )

        # 3. prescriptions — resolve each name to a medication_id; skip any drug
        #    not in the formulary rather than guessing an id
        today = date.today().isoformat()
        for m in medications:
            cur.execute(
                "SELECT id FROM medications WHERE name ILIKE %s", (f"%{m['name']}%",)
            )
            med_row = cur.fetchone()
            if med_row is None:
                continue
            cur.execute(
                """INSERT INTO prescriptions
                       (patient_id, medication_id, surgeon_id, dosage, frequency,
                        start_date, status)
                   VALUES (%s, %s, %s, %s, %s, %s, 'active')""",
                (patient_id, med_row["id"], surgeon_id,
                 m.get("dose") or "unspecified", m.get("frequency") or "unspecified",
                 today),
            )

        # 4. store the diagnosis as an intake document if present
        if primary_diagnosis:
            cur.execute(
                """INSERT INTO patient_documents
                       (patient_id, document_type, summary, uploaded_by)
                   VALUES (%s, %s, %s, %s)""",
                (patient_id, "intake_summary", primary_diagnosis, surgeon_id),
            )

        # 5. audit log — this action is pre-approved by the confirm-and-save tap
        payload = json.dumps({"action": "onboard_patient", "patient_id": patient_id})
        cur.execute(
            """INSERT INTO audit_log
                   (surgeon_id, patient_id, action_type, action_payload, decision, approved_by)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (surgeon_id, patient_id, "onboard_patient", payload, "approved", surgeon_id),
        )

        conn.commit()
        return patient_id


# Curated drug-interaction pairs. A frozenset key makes the lookup
# order-independent (A+B == B+A). This is a demo list, NOT exhaustive —
# an empty result never guarantees the absence of an interaction.
KNOWN_INTERACTIONS = {
    frozenset(["Tacrolimus", "Fluconazole"]): {
        "severity": "major",
        "description": "Fluconazole inhibits CYP3A4 metabolism of Tacrolimus, "
                        "significantly raising Tacrolimus blood levels and risking toxicity."
    },
    frozenset(["Cyclosporine", "Clarithromycin"]): {
        "severity": "major",
        "description": "Clarithromycin inhibits Cyclosporine metabolism, "
                        "risking nephrotoxicity."
    },
    frozenset(["Warfarin", "Aspirin"]): {
        "severity": "major",
        "description": "Combined use significantly increases bleeding risk."
    },
    frozenset(["Warfarin", "Amoxicillin"]): {
        "severity": "moderate",
        "description": "Amoxicillin may potentiate Warfarin's anticoagulant effect."
    },
    frozenset(["Metoprolol", "Amlodipine"]): {
        "severity": "moderate",
        "description": "Combined use may cause additive hypotensive effect. Monitor blood pressure."
    },
    frozenset(["Tacrolimus", "Omeprazole"]): {
        "severity": "moderate",
        "description": "Omeprazole may increase Tacrolimus levels via CYP3A4 inhibition. Monitor trough levels."
    },
    frozenset(["Cyclosporine", "Amlodipine"]): {
        "severity": "moderate",
        "description": "Amlodipine may increase Cyclosporine plasma concentration."
    },
    frozenset(["Lisinopril", "Furosemide"]): {
        "severity": "moderate",
        "description": "Combined use may cause significant hypotension and renal impairment. Monitor kidney function."
    },
    frozenset(["Prednisone", "Metformin"]): {
        "severity": "moderate",
        "description": "Prednisone may reduce Metformin's glucose-lowering effect. Monitor blood sugar."
    },
    frozenset(["Warfarin", "Atorvastatin"]): {
        "severity": "moderate",
        "description": "Atorvastatin may potentiate Warfarin's anticoagulant effect."
    },
}


def check_drug_interactions(proposed_medication: str, patient_id: int) -> list[dict]:
    active_meds = get_active_medications(patient_id)  # already returns list[str]

    results = []
    for current_med in active_meds:
        pair = frozenset([proposed_medication, current_med])
        if pair in KNOWN_INTERACTIONS:
            interaction = KNOWN_INTERACTIONS[pair]
            results.append({
                "with_medication": current_med,
                "severity": interaction["severity"],
                "description": interaction["description"],
            })
    return results
