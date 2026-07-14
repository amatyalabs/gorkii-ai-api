import { API_BASE_URL, SURGEON_ID } from '../constants/config';

// POST /chat/stream — same contract, but the agent loop streams progress.
// Server sends SSE: "data: {\"type\":\"step\"|\"final\"|\"error\", ...}\n\n"
// per event. React Native's fetch doesn't expose a readable response-body
// stream reliably, so this uses XMLHttpRequest's onprogress, where
// responseText accumulates the full response so far on every tick.
export function postChatStream(message, { onStep, onFinal, onApproval, onContext, onError } = {}) {
  const xhr = new XMLHttpRequest();
  let eventsHandled = 0;

  const processEvents = () => {
    const events = xhr.responseText.split('\n\n').filter(Boolean);
    while (eventsHandled < events.length) {
      const dataLine = events[eventsHandled]
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (!dataLine) {
        eventsHandled += 1;
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(dataLine.slice('data: '.length));
      } catch {
        // Trailing event is still arriving — stop and retry on the next
        // progress tick once the rest of the chunk lands.
        break;
      }
      eventsHandled += 1;

      if (parsed.type === 'step') onStep?.(parsed.content);
      else if (parsed.type === 'final') onFinal?.(parsed.content);
      else if (parsed.type === 'approval') onApproval?.(parsed);
      else if (parsed.type === 'context') onContext?.(parsed.content);
      else if (parsed.type === 'error') onError?.(new Error(parsed.content));
    }
  };

  xhr.open('POST', `${API_BASE_URL}/chat/stream`);
  xhr.setRequestHeader('Content-Type', 'application/json');

  xhr.onprogress = processEvents;

  xhr.onerror = () => onError?.(new Error('Network request failed'));
  xhr.onload = () => {
    // The server can close the connection in the same tick as the last
    // SSE event (e.g. "approval", which ends the stream immediately with
    // no trailing "final"). onprogress isn't guaranteed to fire again for
    // that last chunk, so re-run the parse here to avoid dropping it.
    processEvents();
    if (xhr.status < 200 || xhr.status >= 300) {
      onError?.(new Error(`Chat stream failed (HTTP ${xhr.status})`));
    }
  };

  xhr.send(JSON.stringify({ message, surgeon_id: SURGEON_ID }));

  return xhr;
}

// POST /approvals/{id}/resolve — approving executes the paused action
// server-side and writes an audit log; rejecting just marks it rejected.
//   body { status: "approved" | "rejected" } -> { ok: true }
export async function resolveApproval(approvalId, status) {
  const res = await fetch(`${API_BASE_URL}/approvals/${approvalId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, surgeon_id: SURGEON_ID }),
  });

  if (!res.ok) {
    throw new Error(`Resolve failed (HTTP ${res.status})`);
  }

  return res.json();
}

// GET /patients/search?name= — the backend's patient lookup.
//   returns { patients: [ { id, name, medical_record_number, ... } ] }
// An empty name matches everyone (LIKE '%%'), so we load the full list once
// and the Documents screen filters it client-side as the surgeon types.
export async function getPatients() {
  const res = await fetch(`${API_BASE_URL}/patients/search?name=`);

  if (!res.ok) {
    throw new Error(`Couldn't load patients (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.patients ?? [];
}

// POST /patients — create (onboard) a new patient.
//   body { name, date_of_birth, medical_record_number, blood_type }
//   returns { patient_id } (or the created patient)
// NOTE: this endpoint is not built on the backend yet — the Patient
// Onboarding screen calls it, so it needs a POST /patients route to persist.
export async function createPatient(patient) {
  const res = await fetch(`${API_BASE_URL}/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patient),
  });

  if (!res.ok) {
    throw new Error(`Couldn't onboard patient (HTTP ${res.status})`);
  }

  return res.json();
}

// POST /patients/extract — vision extraction for patient onboarding.
//   multipart form: `file` (singular, jpg/png/pdf), plus surgeon_id
//   backend returns { extracted: { source_type, patient, allergies,
//     active_medications, primary_diagnosis } } — unwrapped here.
export async function extractPatient(images) {
  const img = images[0];
  const form = new FormData();
  form.append('file', {
    uri: img.uri,
    name: img.name ?? 'capture.jpg',
    type: img.mimeType ?? 'image/jpeg',
  });
  form.append('surgeon_id', String(SURGEON_ID));

  const res = await fetch(`${API_BASE_URL}/patients/extract`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Extraction failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.extracted ?? data;
}

// POST /patients/extract-voice — text counterpart to extractPatient. The
// Voice tab has no document photo, only a dictation transcript (from
// /voice/transcribe), so this sends that text instead of a file.
//   body: { text, surgeon_id } -> same { extracted: {...} } shape, so
//   patient-confirm.js handles photo/file/voice sources identically.
export async function extractPatientFromVoice(text) {
  const res = await fetch(`${API_BASE_URL}/patients/extract-voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, surgeon_id: SURGEON_ID }),
  });

  if (!res.ok) {
    throw new Error(`Extraction failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.extracted ?? data;
}

// POST /patients/onboard — save a confirmed, edited patient record.
//   body (flat, matches backend OnboardRequest):
//     { name, age, sex, allergies: [{name, confidence, severity}],
//       active_medications: [{name, dose, frequency}], primary_diagnosis,
//       source_ref, surgeon_id }
//   returns { patient_id, status: "onboarded" }
// Confirm & save on the QA screen IS the human approval, so the backend writes
// the record + allergies + prescriptions directly and audit-logs it
// (decision "approved").
export async function saveOnboardedPatient(record) {
  const res = await fetch(`${API_BASE_URL}/patients/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...record, surgeon_id: SURGEON_ID }),
  });

  if (!res.ok) {
    throw new Error(`Couldn't save patient (HTTP ${res.status})`);
  }

  return res.json();
}

// POST /documents/upload — multipart form data (NOT JSON).
//   fields: file (image/pdf), patient_id, surgeon_id, document_type
//   returns { document_id, summary }
// `file` is React Native's { uri, name, type } shape — do NOT set a
// Content-Type header manually, or fetch won't insert the multipart
// boundary and the backend will reject the body.
export async function uploadDocument({ uri, name, mimeType, patientId, documentType }) {
  const form = new FormData();
  form.append('file', { uri, name, type: mimeType });
  form.append('patient_id', String(patientId));
  form.append('surgeon_id', String(SURGEON_ID));
  form.append('document_type', documentType);

  const res = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Upload failed (HTTP ${res.status})`);
  }

  return res.json();
}

// POST /voice/transcribe — AssemblyAI speech-to-text for the chat mic button.
//   multipart form: `file` (the recorded .m4a voice note)
//   returns { text } — dropped into the input box for the surgeon to review
//   and edit before sending (never auto-sent).
export async function transcribeVoice(uri) {
  const form = new FormData();
  form.append('file', { uri, name: 'voice-note.m4a', type: 'audio/m4a' });

  const res = await fetch(`${API_BASE_URL}/voice/transcribe`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Transcription failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.text ?? '';
}

// GET /audit-log?limit= — the chronological audit feed.
//   returns { entries: [ { id, timestamp, action_type, decision,
//     patient_name, surgeon_name, approved_by_name } ] }
export async function getAuditLog(limit = 50) {
  const res = await fetch(`${API_BASE_URL}/audit-log?limit=${limit}`);

  if (!res.ok) {
    throw new Error(`Couldn't load audit log (HTTP ${res.status})`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : data.entries ?? [];
}