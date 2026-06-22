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
