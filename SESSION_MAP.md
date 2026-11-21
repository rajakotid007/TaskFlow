# Session Map

TaskFlow was built in **one** Claude Code session (VS Code extension, model
Claude Opus 5.5), 2026-11-20 → 2026-11-21. The phases below are stages of
that single session, not separate sessions.

| # | Stage | What happened | Key outputs |
|---|---|---|---|
| 1 | Initial planning | Inspected toolchain (no Ruby/Postgres/Redis locally → Docker). Wrote the architecture: three state machines, DB invariants, locking, routing lifecycle. | `ARCHITECTURE.md`, `docker-compose.yml`, `backend/Dockerfile.dev` |
| 2 | Environment recovery | WSL/Docker hung; corrupted image rebuilt; user approved WSL + Docker restart. | Working Rails 8 skeleton |
| 3 | Backend foundation & routing engine | Migration with CHECK constraints and partial unique indexes, models, services, Sidekiq job, controllers; 103 RSpec examples; seeds driven through real services; live curl checks. | `backend/app/**`, `backend/spec/**`, `db/seeds.rb` |
| 4 | **Change of direction: runtime incompatibilities** | `json` 3 / `redis` 6 / `connection_pool` 3 failures found at runtime and pinned; Sidekiq poll-interval drift diagnosed from source and fixed. | `backend/Gemfile` comments, `config/initializers/sidekiq.rb` |
| 5 | Frontend | Vite + React + TS + Tailwind; 8 pages; real-time via Action Cable with polling fallback; screenshot review in Edge and layout fixes. | `frontend/src/**` |
| 6 | **Change of direction: disk full / port conflict** | Disk reached 0 MB; user approved clearing npm and Docker build caches; Playwright switched to system Edge; frontend moved to port 5174. | `playwright.config.ts`, compose origins |
| 7 | Final testing & verification | Vitest (18), Playwright (5 scenarios, two clean runs), RSpec (103), RuboCop, ESLint, tsc; worker-restart and Redis-outage checks. | `TESTING.md` |
| 8 | Documentation | README, assumptions, testing, AI log, this map. | `*.md` |

## Session export

The brief asks for the original AI session exports. The assistant cannot export
its own session. To include it, export the conversation from Claude Code (for
example with `/export` in the session, or by copying the transcript from
`~/.claude/projects/`) and place it alongside this file, e.g.
`ai-sessions/taskflow-build-session.md`. This repository does **not** contain
that export yet.
