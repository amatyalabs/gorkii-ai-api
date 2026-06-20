from tools import get_patient_allergies
from tools import classify_action
from tools import ProposedAction
from tools import Decision

def test_patient_allergies():
    patient_id = 1
    allergy_list = get_patient_allergies(patient_id)
    assert set(allergy_list) == {"Aspirin", "Ibuprofen", "Amoxicillin"}
    
def test_database_write_approval():
    action = ProposedAction(action_type="suggestion", writes_to_db=True, description="test")
    decision = classify_action(action)
    assert decision == Decision.NEEDS_APPROVAL
    
def test_unsafe_action_type_approval():
    action = ProposedAction(action_type="prescription", writes_to_db=False, description="test")
    decision = classify_action(action)
    assert decision == Decision.NEEDS_APPROVAL
    
def test_safe_and_unsafe_approval():
    action = ProposedAction(action_type="safe_action", writes_to_db=True, description="test")
    decision = classify_action(action)
    assert decision == Decision.NEEDS_APPROVAL
    
def test_safe_action_type_approval():
    action = ProposedAction(action_type="get_allergies", writes_to_db=False, description="test")
    decision = classify_action(action)
    assert decision == Decision.SAFE
    