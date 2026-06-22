@AGENTS.md
# Doctors Nepal — Project Context for Claude Code

This file orients Claude Code. The mobile app lives in `/mobile`. The backend
lives in `/backend` and is owned and understood line-by-line by the developer —
**do not refactor, rewrite, or "improve" backend files unless explicitly asked.**

---

## What this product is

An agentic AI clinical decision support (CDS) tool for surgeons in Nepal.
A surgeon sends a natural-language request; an LLM agent gathers patient context
through typed tools, and any action that writes to the database is intercepted by
a deterministic safety gate and routed to a human for approval before it executes.

The product is called **Doctors Nepal**. The mobile app is the surgeon-facing
interface. The current focus is the **chat screen**; login is just the gate.

---

## Repository layout

```
/backend        Python — FastAPI + MCP server + SQLite. OWNED BY DEVELOPER.
/mobile         React Native (Expo). This is where Claude Code works.
```

---

## Backend you must NOT touch (but must understand to integrate)

The mobile app talks to the backend over HTTP. The developer is building these
FastAPI endpoints. Treat this as the contract. If an endpoint doesn't exist yet,
flag it — do not invent backend changes yourself.

Planned/!existing endpoints the app will call:

```
POST /chat
  body:   { "message": str, "surgeon_id": int }
  returns:{ "response": str }
  // runs the agent loop; may return a normal answer OR a message saying
  // an action needs approval

GET  /approvals?surgeon_id={id}
  returns: [ { id, action_type, description, patient_id,
               approval_status, created_at } ]
  // pending approvals waiting for this surgeon

POST /approvals/{id}/resolve
  body:   { "status": "approved" | "rejected" }
  returns:{ "ok": true }
  // approving executes the paused action server-side and writes an audit log
```

Auth is not built yet. For now the app may hardcode `surgeon_id = 1` and pass it
explicitly. Do NOT build a real auth system unless asked — when auth lands it will
come from the backend as a token, and `surgeon_id` will be derived server-side.

---

## The safety color language (important — not decoration)

Green and red encode safety state across the whole product. Use them ONLY for this:

- **Green `#3BA55D`** — primary action, "safe" / "approved" states
- **Red `#ED4245`** — high-risk / "approval required" / "rejected" states

Everywhere else is neutral dark grey. A button being green should *mean* something.

### Palette (dark, Discord-ish, disciplined)

```
#1E1F22  base background (deepest)
#2B2D31  surface — cards, input fields
#313338  elevated surface
#F2F3F5  primary text
#B5BAC1  secondary text
#3BA55D  safe / primary action accent
#ED4245  high-risk / approval-required accent
```

---

## Design principles for the app

- Clean, minimal, understandable with **zero instructions**. A surgeon under time
  pressure should never wonder what a screen does.
- Match minimalism with precision: spacing, type scale, and alignment must be tight.
  Minimal is not an excuse for loose.
- One accent at a time. Login shows only the green primary button; no red yet.
- Structured input beats free text for clinical data. When the app eventually has
  a prescription form, prefer dropdowns/pickers over typed fields.
- Sentence case. Active-voice buttons that name what happens ("Send", "Approve",
  not "Submit"). The button label and the resulting state share a vocabulary.

---

## Current build order

1. **Login / sign-up** — simple email + password, single screen. Just a gate.
2. **Chat screen** — THE focus. A message list + input bar. Sends to `POST /chat`,
   renders the agent's reply. This is the product.
3. Pending approvals screen — lists `GET /approvals`, each with Approve/Reject
   that calls `POST /approvals/{id}/resolve`. (Later.)

---

## Conventions

- Expo, functional components, hooks. No class components.
- Keep API base URL in one config constant so it's swappable
  (local dev vs deployed). The developer will provide the ngrok/host URL.
- No browser storage assumptions; use React state / async storage as appropriate.
- When you add a screen, explain what it does in 2-3 sentences and call out any
  backend endpoint it depends on that doesn't exist yet.

---

## How to work with this developer

The developer is strong in Java, newer to Python and React Native, and is
deliberately learning the architecture. For the mobile app they want you to
generate and they review. So:

- Generate working code, but explain the *why* of any non-obvious choice.
- When something touches the backend contract above, call it out explicitly so
  they can verify it — that boundary is theirs to own.
- Don't silently add libraries; name them and why.