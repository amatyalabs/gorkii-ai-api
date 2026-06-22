import { API_BASE_URL, SURGEON_ID } from '../constants/config';

// Backend contract (CLAUDE.md):
//   POST /chat  body { message, surgeon_id } -> { response }
// Runs the agent loop; the response may be a normal answer OR a message
// saying an action needs approval. Here we just surface the string.
export async function postChat(message) {
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, surgeon_id: SURGEON_ID }),
  });

  if (!res.ok) {
    throw new Error(`Chat request failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.response;
}

// POST /chat/stream — same contract, but the agent loop streams progress.
// Server sends SSE: "data: {\"type\":\"step\"|\"final\"|\"error\", ...}\n\n"
// per event. React Native's fetch doesn't expose a readable response-body
// stream reliably, so this uses XMLHttpRequest's onprogress, where
// responseText accumulates the full response so far on every tick.
export function postChatStream(message, { onStep, onFinal, onApproval, onError } = {}) {
  const xhr = new XMLHttpRequest();
  let eventsHandled = 0;

  xhr.open('POST', `${API_BASE_URL}/chat/stream`);
  xhr.setRequestHeader('Content-Type', 'application/json');

  xhr.onprogress = () => {
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
      else if (parsed.type === 'approval') onApproval?.(parsed.approval_id, parsed.content);
      else if (parsed.type === 'error') onError?.(new Error(parsed.content));
    }
  };

  xhr.onerror = () => onError?.(new Error('Network request failed'));
  xhr.onload = () => {
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
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    throw new Error(`Resolve failed (HTTP ${res.status})`);
  }

  return res.json();
}
