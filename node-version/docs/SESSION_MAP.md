# AI session map

One build session produced this codebase. Session identifier from the environment: `session_01MD3wFStTLMUBzsRdUZJ29N` (https://claude.ai/code/session_01MD3wFStTLMUBzsRdUZJ29N).

I did not export the transcript in this environment. Attach the official export from the session page when submitting.

| Phase | What happened | Where to see it |
|---|---|---|
| 1. Planning | Read the master prompt. Checked tooling. Rails install blocked (403). Operator chose a Node/TypeScript backend. | `AI_DEVELOPMENT_LOG.md` §Initial planning |
| 2. Backend foundation | Schema, state machine, services, Fastify API, migration, seed | `backend/src/` |
| 3. Routing engine | BullMQ delayed jobs, simulation, result handler, stale-result handling | `backend/src/services/routing.ts`, `queue.ts` |
| **Correction A** | Seed hung (Redis down; publisher retried forever) | `AI_DEVELOPMENT_LOG.md` item 1 |
| **Correction B** | Reused job IDs silently blocked new routing jobs after reset | item 7 |
| **Correction C** | Cancelling a superseded job hid the late result | item 8 |
| 4. Frontend | Vite/React/TS console, TanStack Query, RHF + Zod, Recharts, WebSocket with polling | `frontend/src/` |
| 5. Verification | Backend 54/54, frontend 14/14, Playwright 4/4 | `TESTING.md` |
| 6. Documentation | Architecture, assumptions, API, testing, this log and map | `docs/` |
