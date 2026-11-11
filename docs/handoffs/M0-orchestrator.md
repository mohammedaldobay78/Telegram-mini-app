MILESTONE: M0
STATUS: done
DELIVERED: package.json, tsconfig.json, next.config.ts, postcss.config.mjs, tailwind.config.ts, drizzle.config.ts, vitest.config.ts, pnpm-workspace.yaml, .env.example, .gitignore, .github/workflows/ci.yml, src/app/layout.tsx, src/app/globals.css, src/app/api/health/route.ts
CONTRACTS CHANGED: repository layout (PLAN §4.2), pnpm scripts (`dev`, `build`, `typecheck`, `test`, `simulate`, `db:generate`, `db:migrate`, `db:seed`, `db:check`), env schema (`src/lib/env.ts`)
TESTS: `node node_modules/typescript/bin/tsc --noEmit` → clean; `/api/health` route present
FOLLOW-UPS: release-agent must register the production env vars from `.env.example`
RISKS: local Windows shell is PowerShell; scripts must not assume POSIX. No git repository was initialised, so CI only runs once the directory is pushed.
