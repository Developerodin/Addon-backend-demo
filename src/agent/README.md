# Agent-Driven UI Playback System

## What We Are Building (Cursor context)

We are building an **Agent-driven UI Playback system** for our ERP/CRM.

- **Goal:** Visually replay ERP workflows (e.g. Purchase Order creation) **after** the backend has already created the data. Triggered by chatbot or automation.
- **Not:** Let the UI create data. The UI only **replays** steps; backend is source of truth.

**High-level:** Backend = source of truth. UI = actor (visual playback only).

**Flow:**
1. Chatbot / Automation → Backend creates Order + PO (real data)
2. Backend creates an Agent Job
3. Backend streams UI steps (SSE)
4. Frontend AgentPlayer replays steps visually
5. Frontend notifies backend when playback is done
6. Chatbot sends final success message

**Why:** Safe chatbot-driven ERP actions; show users what happened; no duplicate submits; explainable, auditable, replayable automation.

---

## Core Concepts

### 1. Agent Job
Record for one UI playback session. Stored in `agent_jobs`.
- `jobId`, `flowKey`, `refType`, `refId`, `context`, `status` (pending | running | completed | failed), timestamps.

### 2. UI Flow (JSON template)
Reusable script of UI steps. Lives in `src/agent/ui-flows/*.json`.
- Steps reference data via `from: "order.items"` etc.; data comes from `job.context`.

### 3. Context (runtime data)
Set when creating the job. Example: `{ order: { purchaseDate, supplierName, items, notes } }`. Flow steps use `from: "order.items"` etc.

### 4. AgentPlayer (frontend)
Single global component that: connects to SSE stream, executes steps (NAVIGATE, CLICK, SET_VALUE, SET_ITEMS, …), uses `data-agent` attributes, blocks real submit, calls `/complete` on DONE.

### 5. data-agent attributes
UI hooks for the player. Example: `data-agent="purchase.po.new.btn"`, `data-agent-row="purchase.po.item"`.

### 6. Visual-only submit
When `window.__AGENT_FLOW_ACTIVE__` is true: submit is visual-only (no API call); success modal is shown for UX.

---

## Backend APIs (`/v1/agent`)

| Method | Path | Purpose |
|--------|------|--------|
| POST | `/ui-flow/job` | Create job (pending). Body: `jobId`, `flowKey`, `refType?`, `refId?`, `context?` |
| POST | `/ui-flow/start` | Mark job running. Body: `{ jobId }` |
| GET | `/ui-flow/stream?jobId=...` | SSE stream of resolved steps (one-by-one with delay). If job already completed, sends DONE only. |
| POST | `/ui-flow/complete` | Mark job completed. Body: `{ jobId }`. Idempotent. |

All routes require auth (JWT).

---

## What Cursor Should Help With
- AgentPlayer logic, step execution, retries, pause/resume, reusable engine for other ERP flows.
- **Not:** Rework business logic, move PO creation into UI, or trigger real submits during playback.

**One-line summary:** Backend-driven, intent-based UI playback: backend does real ERP work; frontend replays it via flows and DOM hooks (e.g. for chatbot automation).
