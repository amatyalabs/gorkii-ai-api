from mcp.server.fastmcp import FastMCP
from tools import get_patient_documents as _get_patient_documents, get_pending_approvals as _get_pending_approvals, get_patient_allergies as _get_patient_allergies, get_active_medications as _get_active_medications, get_medication_by_name as _get_medication_by_name, find_patient_by_name as _find_patient_by_name, get_active_prescription as _get_active_prescription, update_prescription as _update_prescription, ProposedAction, Decision

mcp = FastMCP("hospital")

@mcp.tool()
def get_patient_allergies(patient_id: int) -> list[str]:
    """Return all known allergy substances for a patient by ID.

    Always call this before any medication is discussed or prescribed.
    An empty result means no allergies are recorded in this system — not
    that the patient has no allergies. If the list is empty, tell the surgeon
    the allergy record may be incomplete and advise independent verification.
    If a proposed medication matches or is related to a known allergen,
    flag the conflict clearly and do not proceed without surgeon confirmation."""
    return _get_patient_allergies(patient_id)
    
@mcp.tool()
def get_active_medications(patient_id: int) -> list[str]:
    """Return the names of all currently active medications for a patient.

    Use this to give the surgeon an overview of what the patient is currently
    taking. An empty result means no active medications are recorded — not
    that the patient takes nothing. Always retrieve this before proposing
    any prescription change so the surgeon has full context."""
    return _get_active_medications(patient_id)

@mcp.tool()
def find_patient_by_name(name: str) -> list[dict]:
    """Search for patients by name. Returns a list of matching patients, each
    with id, name, date_of_birth, and medical_record_number.

    Call this first whenever a surgeon refers to a patient by name.
    If multiple matches are returned, present all of them with DOB and MRN
    and ask the surgeon to confirm which patient before proceeding.
    Never assume which patient is correct when there are multiple matches."""
    return _find_patient_by_name(name)

@mcp.tool()
def get_active_prescription(patient_id: int, medication_id: int) -> dict | None:
    """Check whether a patient has an active prescription for a specific
    medication. Returns the prescription id, dosage, and frequency, or
    None if no active prescription exists.

    Call this before update_prescription to show the surgeon what is
    currently prescribed so they can see the before/after context.
    Requires a valid medication_id — use get_medication_by_name first."""
    return _get_active_prescription(patient_id, medication_id)
    
@mcp.tool()
def update_prescription(patient_id: int, 
    medication_id: int, 
    surgeon_id: int, 
    dosage: str, 
    frequency: str, 
    start_date: str, 
    end_date: str | None = None)-> None:
    """Propose a new or updated prescription for a patient. If an active
    prescription for this medication already exists, it will be marked
    completed and replaced with the new one, preserving history.

    THIS IS A WRITE OPERATION — it will always be intercepted by the
    safety gate and require surgeon approval before executing.

    Required call order before using this tool:
    1. find_patient_by_name → confirm patient_id
    2. get_medication_by_name → confirm medication_id (never guess)
    3. get_patient_allergies → check for conflicts
    4. get_active_prescription → show current state to surgeon
    Only then propose this action with all confirmed IDs.

    NEVER pass a surgeon_id argument to this tool, not even a placeholder
    or zero. Omit the parameter entirely from your tool call. It will be
    injected automatically during the approval step."""
    return _update_prescription(patient_id, medication_id, surgeon_id, dosage, frequency, start_date, end_date)
    
@mcp.tool()
def get_medication_by_name(name: str) -> dict | None:
    """Look up a medication by name and return its id, name, category,
    typical_dosage, and notes.

    Always call this to resolve a medication name to its database ID before
    calling get_active_prescription or update_prescription. Never guess or
    assume a medication_id — an incorrect ID will silently operate on the
    wrong drug. Returns None if no matching medication is found; in that
    case tell the surgeon the medication is not in the formulary."""
    return _get_medication_by_name(name)

@mcp.tool()
def get_pending_approvals(surgeon_id: int) -> list[dict]:
    """
    Return all pending approvals waiting for a specific surgeon.
    Each result includes the approval id, action_type, description,
    patient_id, approval_status, and created_at timestamp.

    Use this when a surgeon asks what actions are awaiting their review,
    or to check the status of a previously submitted request.
    """
    return _get_pending_approvals(surgeon_id)

@mcp.tool()
def get_patient_documents(patient_id: int) -> list[dict]:
    """
    Retrieve all stored clinical documents for a patient, ordered most
    recent first. Each result includes document_type, summary, 
    surgeon_notes, uploaded_by, and created_at.

    Call this when a surgeon asks about lab results, radiology reports,
    operative notes, or any previously uploaded clinical documents for
    a patient. Use the summary field to answer specific questions about
    findings — the full document text is in that field.

    If the list is empty, tell the surgeon no documents have been
    uploaded for this patient yet — do not imply there are no records,
    only that none have been scanned into this system.

    To filter by type, scan the returned list for document_type values
    matching what the surgeon asked for (e.g. 'lab_result',
    'radiology_report') rather than calling this tool multiple times.
    """
    return _get_patient_documents(patient_id)

if __name__ == "__main__":
    mcp.run()