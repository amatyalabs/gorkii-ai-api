from database import get_connection
from pydantic import BaseModel
from enum import Enum
import json

class ProposedAction(BaseModel):
    action_type: str
    writes_to_db: bool
    description: str
    
class Decision(Enum):
    SAFE = "safe"
    NEEDS_APPROVAL = "needs_approval"

def get_patient_allergies(patient_id: int) -> list[str]:
    with get_connection() as conn:
        cur = conn.cursor()
        get_allergies_query = """SELECT substance FROM allergies 
                                WHERE patient_id = ?;"""
        cur.execute(get_allergies_query, (patient_id,))
        rows = cur.fetchall()  
    return [row["substance"] for row in rows]

def get_active_medications(patient_id: int) -> list[str]:
    with get_connection() as conn:
        cur = conn.cursor()
        active_medication_query = """SELECT medications.name FROM medications
       INNER JOIN prescriptions ON prescriptions.medication_id = medications.id
       WHERE prescriptions.patient_id = ? AND prescriptions.status = 'ACTIVE';"""
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
        patient_name_query = """SELECT id, name, date_of_birth, medical_record_number FROM patients WHERE name LIKE ?;"""
        cur.execute(patient_name_query, (f"%{name}%",))
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
        insert_audit_entry = """INSERT INTO audit_log(action_type, action_payload, decision, surgeon_id, patient_id, approved_by) VALUES (?, ?, ?, ?, ?, ?);"""
        cur.execute(insert_audit_entry, (action.action_type, payload, decision.value, surgeon_id, patient_id, approved_by))
        conn.commit()

def get_active_prescription(patient_id: int, medication_id: int) -> dict | None:
    with get_connection() as conn:
        cur = conn.cursor()
        medication_query = """SELECT id, dosage, frequency FROM prescriptions
WHERE patient_id = ? AND medication_id = ? AND status = 'active';"""
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
            query = """INSERT INTO prescriptions (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"""
            cur.execute(query, (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, 'active'))
        else:
            update_query = """UPDATE prescriptions SET status='completed' WHERE id = ?;"""
            cur.execute(update_query, (existing.get("id"),))
            insert_query = """INSERT INTO prescriptions (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"""
            cur.execute(insert_query, (patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date, 'active'))
        conn.commit()
            
    
        

