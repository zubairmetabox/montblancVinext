# Local Run Incident Report (Port 3002)

Date: 2026-03-02
Project: `/Users/Sumayyah/Documents/montblancVinext`
Goal requested: run existing Vinext-migrated project locally on port `3002`.

## Executive Summary
- The app did not reach a stable local run in this session.
- Multiple separate blockers were identified, including process-state issues, module resolution config gaps, and local filesystem/package-manager instability.
- A reproducible runtime error (`Cannot find module '@/lib/queries'`) was identified and patched in `vite.config.ts`.
- Additional environment-level issues (stale/orphaned dev processes, intermittent dataless iCloud files, npm install hangs, missing optional rollup binary, and flaky background process startup in this environment) prevented complete stabilization.

## What Was Requested
- Do **not** clone anything.
- Run the already-migrated Vinext project locally.
- Bind on port `3002`.

## Chronological Log (Condensed)
1. Confirmed existing process/listener checks on `3002` and `3010`.
2. Confirmed CMS mock endpoint was healthy at `http://127.0.0.1:3010/health` at several points.
3. Observed multiple stale/orphaned Vite/Vinext processes bound to `3002` that accepted TCP but returned no HTTP payload.
4. Repeated clean restarts were attempted (direct `vite`, `npm run dev:vinext`, debug mode, background and foreground execution).
5. Found concrete frontend runtime error on `3002`:
   - `Cannot find module '@/lib/queries' imported from '/Users/Sumayyah/Documents/montblancVinext/src/app/api/orders/route.ts'`
6. Patched `vite.config.ts` to add alias mapping `@ -> src`.
7. Restart attempts continued; background process launch remained inconsistent in this Codex shell environment.
8. Found Node compatibility signal:
   - Node 20 run failed in Vinext internals due `node:fs/promises` `glob` export usage.
   - Node 22 remained required for this setup.
9. Found package/runtime integrity issue:
   - Missing optional dependency: `@rollup/rollup-darwin-arm64`.
10. Found package manager instability:
   - `npm i`/targeted installs repeatedly hung at manifest fetch phases in this environment.
11. Found filesystem hydration issue:
   - Many files in workspace were marked `dataless` (iCloud placeholder state), which can stall config/file reads under load.

## Key Errors Captured

### 1) Alias Resolution Error
`Cannot find module '@/lib/queries' imported from '/Users/Sumayyah/Documents/montblancVinext/src/app/api/orders/route.ts'`

Impact:
- App boots enough to show Vite overlay, then fails resolving path aliases in Vinext runtime.

Fix applied:
- Added `"@": path.resolve(dirname, "src")` in `vite.config.ts`.

### 2) Node Version Compatibility
Running with Node 20 produced:
- `SyntaxError: The requested module 'node:fs/promises' does not provide an export named 'glob'`

Impact:
- Confirms Node 20 is not suitable for this Vinext setup/version path.

### 3) Missing Rollup Optional Binary
- `Cannot find module @rollup/rollup-darwin-arm64`

Impact:
- Vite startup can hard-fail.

### 4) NPM/Config Read Instability
NPM logs showed timeouts while reading project config and package fetch phases stalling.

Impact:
- Dependency repair became unreliable in-session.

### 5) Dataless (iCloud) Files
Large counts of workspace files reported with `dataless` flag at times.

Impact:
- Tooling can block/hang on file access under watch/build workloads.

## File Changes Made In This Session

### Edited
- `/Users/Sumayyah/Documents/montblancVinext/vite.config.ts`
  - Added alias for `@` to `src`.
- `/Users/Sumayyah/Documents/montblancVinext/tsconfig.json`
  - Removed trailing commas (strict JSON cleanup).

### Workspace State Noted (Pre-existing and/or changed during this broader migration flow)
Current `git status --short` includes many modified/untracked files unrelated to only this run incident, e.g.:
- `M package.json`, `M package-lock.json`, `M .env.example`, `M next.config.mjs`, `M src/lib/queries.ts`, `M tsconfig.json`
- `?? vite.config.ts`, `?? wrangler.jsonc`, `?? worker/`, `?? apps/`, `?? documentation/migration/`, `?? shims/`, `?? app`, `?? dist/`
- `.npmrc` currently shows as deleted with `.npmrc.bak` present.

Important:
- `.npmrc` was moved to `.npmrc.bak` during troubleshooting to bypass read-timeout behavior.

## Commands That Were Central
- CMS mock health:
  - `curl -i http://127.0.0.1:3010/health`
- Vinext run attempts:
  - `PATH="/opt/homebrew/opt/node@22/bin:$PATH" CMS_BASE_URL=http://127.0.0.1:3010 node ./node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 3002`
- Listener checks:
  - `lsof -nP -iTCP:3002 -sTCP:LISTEN`
- Direct page probe:
  - `curl -i http://127.0.0.1:3002/`

## Likely Root Cause Cluster
This was not a single-code-line issue. The failure appears to be a combination of:
1. Incomplete Vite alias config for Vinext runtime (`@` alias) -> fixed.
2. Unstable local process state (orphan Vite workers on same port).
3. Dependency integrity problems (`@rollup/rollup-darwin-arm64` missing and npm hangs).
4. Filesystem hydration issues (dataless/iCloud placeholders causing intermittent read stalls).

## Immediate Recovery Checklist For Next Agent
1. Restore `.npmrc` first:
   - `mv .npmrc.bak .npmrc` (if desired), or keep disabled intentionally and document why.
2. Ensure no stale listeners:
   - kill all `vite`/`next` processes for this repo and verify `lsof` is clean.
3. Ensure local files are fully hydrated (not dataless) before build/watch.
4. Reinstall dependencies in a stable terminal (outside this Codex shell), ideally with a clean lockfile strategy agreed by owner.
5. Keep Node at 22+ for current Vinext version path.
6. Confirm `vite.config.ts` includes alias:
   - `"@": path.resolve(dirname, "src")`
7. Start CMS mock and then Vinext on `3002`.
8. Verify both:
   - `curl -i http://127.0.0.1:3010/health`
   - `curl -i http://127.0.0.1:3002/`

## Suggested Clean Start Script (for next agent)
Run manually in a normal terminal:

```bash
cd /Users/Sumayyah/Documents/montblancVinext

# Optional: restore npmrc if needed
[ -f .npmrc.bak ] && mv .npmrc.bak .npmrc

# Kill stale processes
pkill -f "montblancVinext.*vite" || true
pkill -f "montblancVinext.*next" || true

# Start CMS mock (terminal 1)
CMS_MOCK_MODE=true CMS_PORT=3010 node apps/cms/server.mjs

# Start Vinext (terminal 2)
PATH="/opt/homebrew/opt/node@22/bin:$PATH" \
CMS_BASE_URL=http://127.0.0.1:3010 \
node ./node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 3002
```

## Final Status At Handoff
- Not successfully stabilized to a clean working local run in this session.
- Alias issue causing the specific overlay error was fixed in code.
- Environment/process/dependency stability issues remain and should be handled in a clean terminal session by the next agent.
