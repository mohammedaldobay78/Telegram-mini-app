# ADR-0001 — Stack, repository layout and deployment target

- **Status:** accepted
- **Date:** 2026-11-11
- **Owners:** orchestrator
- **PLAN refs:** §4.1, §4.2, §4.3, §13 (M0)

## Context

PLAN §4.1 fixes the stack. The repository had to be created from an empty
directory on Windows, with no existing tooling, while keeping the layout from
PLAN §4.2 and the milestone order from AGENT.md §A.2.

## Decision

Use the stack exactly as specified:

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS 3 with Telegram theme variables |
| Data | Postgres + Drizzle ORM, forward-only migrations |
| Bot | grammY in webhook mode |
| Client state | TanStack Query + Zod validation |
| Cache / limits | Upstash Redis when configured; in-process fallback for dev/tests |
| Ads | Provider interface (`mock`, `adsgram`) |
| Hosting | Vercel + Vercel Cron |

Repository rules:

- `src/app` — routes and screens only.
- `src/server` — economy, services, security, Telegram, HTTP wrapper.
- `src/lib` — shared schemas, types, formatting, env.
- `src/db` — schema, client, seed, migrations.
- `scripts` — simulator, migrations, webhook/gift checks.
- `tests/{unit,integration,fraud}` — Vitest suites.

Package manager is `pnpm`. The lockfile is committed. No dependency is added
without orchestrator approval (AGENT.md §A.5).

## Consequences

- One deployable unit serves both the Mini App and the API routes.
- PGlite is used for integration tests so the real migrations run without a
  local Postgres server.
- Vercel serverless constraints force all heavy work into cron routes and keep
  request handlers short (PLAN §4.5).
- The in-process Redis fallback is acceptable for local/dev and tests but
  production must set `REDIS_URL` + `REDIS_TOKEN`.
