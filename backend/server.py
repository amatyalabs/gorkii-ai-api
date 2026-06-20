from mcp.server.fastmcp import FastMCP
from tools import get_patient_allergies as _get_patient_allergies, classify_action as _classify_action, get_active_medications as _get_active_medications, log_audit_entry as _log_audit_entry, find_patient_by_name as _find_patient_by_name, get_active_prescription as _get_active_prescription, update_prescription as _update_prescription, ProposedAction, Decision


mcp = FastMCP("hospital")

@mcp.tool()
def get_patient_allergies(patient_id: int) -> list[str]:
    """Return allergy substances for a patient. Check before any prescription."""
    return _get_patient_allergies(patient_id)
    
@mcp.tool()
def get_active_medications(patient_id: int) -> list[str]:
    """Return active medications for a patient."""
    return _get_active_medications(patient_id)

@mcp.tool()
def find_patient_by_name(name: str) -> list[dict]:
    """Find patient by name."""
    return _find_patient_by_name(name)

@mcp.tool()
def get_active_prescription(patient_id: int, medication_id: int) -> dict | None:
    """Get the active prescription id, dosage, and frequency."""
    return _get_active_prescription(patient_id, medication_id)
    
@mcp.tool()
def update_prescription(patient_id: int, 
    medication_id: int, 
    surgeon_id: int, 
    dosage: str, 
    frequency: str, 
    start_date: str, 
    end_date: str | None = None)-> None:
    """Update or insert a new prescription for the patient."""
    return _update_prescription(patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date)
    

if __name__ == "__main__":
    mcp.run()