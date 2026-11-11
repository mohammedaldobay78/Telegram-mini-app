MILESTONE: M9
STATUS: partial
DELIVERED: docs/decisions/ADR-0001..0005, docs/handoffs/M0..M8, docs/ops/runbook.md, docs/security/threat-model.md, full unit/integration/fraud suites (106 tests), simulator, CI workflow
CONTRACTS CHANGED: none beyond M0–M8
TESTS: `tsc --noEmit` clean; Vitest 106/106; `pnpm simulate` green; `drizzle-kit check` clean
FOLLOW-UPS: release-agent must (1) deploy to Vercel staging, (2) run Playwright E2E against the staging bot, (3) configure BotFather menu/webhook, (4) set `AD_PROVIDER=adsgram` and the Adsgram postback, (5) run the kill-switch drill, (6) verify the Stars balance floor, (7) record the launch checklist evidence
RISKS: no staging deployment has been executed from this workspace. E2E is not implemented (`tests/e2e` is empty), so the launch gate is incomplete until the release-agent adds it. The workspace is not a git repository; CI has not run remotely.
