# Migration Plan: Next.js + Payload -> Vinext + Cloudflare

## 1) Current State (from this repo)

- Frontend + Admin are currently coupled through `@payloadcms/next`.
- Payload API/Admin routes live inside Next App Router:
  - `src/app/(payload)/api/[...slug]/route.ts`
  - `src/app/(payload)/admin/[[...segments]]/page.tsx`
- Public storefront routes are in `src/app/(frontend)`.
- Checkout API endpoint: `src/app/api/orders/route.ts`.
- Data layer is Payload Local API (`src/lib/queries.ts`) plus Neon Postgres.
- Media storage is Vercel Blob via `@payloadcms/storage-vercel-blob` in `src/payload.config.ts`.

## 2) Key Constraint You Need to Plan Around

Vinext can deploy nicely to Cloudflare Workers (Nitro preset), but this codebase currently depends on a Next-specific Payload integration (`@payloadcms/next`) and Node-oriented runtime pieces (Payload admin stack, `sharp`, postgres driver path, Vercel Blob plugin coupling).

That means: **don’t do a big-bang switch**. Migrate in stages, separating storefront from CMS runtime first.

## 3) Migration Strategy Options

### Option A: Split Architecture, Migrate Storefront First

- Move storefront from Next -> Vinext.
- Keep Payload CMS/API as a separate service (Node host).
- Storefront consumes Payload via REST/GraphQL instead of Local API.
- Host storefront on Cloudflare (free/cheap), keep CMS/API on low-cost Node host.

Pros:
- Lowest risk.
- Fast path to Cloudflare cost savings for traffic-heavy frontend.
- Keeps Payload admin stable while frontend migrates.

Cons:
- Two deployments instead of one.
- Need auth/CORS and API contracts between frontend and CMS.

### Option B (Chosen): Full Re-platform (Vinext + non-Next Payload runtime) in One Program

- Replace `@payloadcms/next` integration with a standalone Payload server.
- Rebuild admin/API mounting and all frontend in Vinext.
- Attempt to run everything behind one domain.

Pros:
- Cleaner long-term architecture.
- Fully decoupled from Next.

Cons:
- Highest complexity and migration time.
- Higher risk of regressions in admin/auth/uploads.
- Not ideal if your main goal is fast/cheap hosting soon.

### Option C: Keep Next.js, Optimize Hosting Cost First

- Keep app as-is.
- Move off Vercel to cheaper Node host (or keep Vercel Hobby/Pro as needed).
- Defer Vinext migration until post-launch stability window.

Pros:
- Minimal engineering change.
- Fastest to ship.

Cons:
- Doesn’t meet immediate Vinext migration goal.

## 4) Cloudflare Hosting Options (Free/Cheap)

### Option 1: Cloudflare for Storefront + Separate CMS Host

- Storefront: Vinext deployed to Cloudflare Workers.
- CMS/API (Payload): Railway / Fly.io / Render / self-hosted VPS.
- Database: Neon (keep current).
- Media: move from Vercel Blob to Cloudflare R2 (optional phase 2), or keep Blob initially.

Best for: Low cost + practical migration.

### Option 2 (Chosen for Initial Deployment): Cloudflare Frontend + Keep CMS on Vercel Temporarily

- Move only storefront to Vinext/Cloudflare.
- Keep existing Payload/Next admin deployment on Vercel until backend migration is done.

Best for: Fastest migration while you re-platform architecture in parallel.

### Option 3 (Target Later): Full Cloudflare Runtime

- Try to run all backend workloads in Cloudflare runtime.

Risk:
- Payload and dependent ecosystem features may require Node behaviors that increase compatibility work and maintenance.

Your selected sequence:
- Step 1: Build Option B architecture (Vinext + standalone/non-Next Payload runtime).
- Step 2: Deploy with Option 2 (Cloudflare frontend + CMS on Vercel temporary).
- Step 3: Migrate CMS/API to full Cloudflare-compatible deployment later (Option 3 target).

## 5) Suggested Execution Plan (Phased for Your Chosen Path)

## Phase 0 - Discovery and Freeze (1-2 days)

- Freeze schema + route changes in main branch.
- Inventory all Next-only features currently used:
  - `next/image`, route handlers, metadata APIs, font loading, middleware usage.
- Define API contract from standalone Payload to Vinext frontend (collections/products/orders endpoints).
- Establish acceptance benchmarks:
  - Lighthouse, TTFB, p95 API latency, checkout success rate.

Deliverables:
- Route parity checklist.
- API contract doc.
- Baseline performance report.

## Phase 1 - Standalone Payload Runtime Extraction (3-6 days)

- Remove `@payloadcms/next` integration and create a standalone Payload server app (Node runtime).
- Move/replace Next-mounted Payload endpoints from `src/app/(payload)` to standalone server routing.
- Keep same collections and schema contracts (`Products`, `PenCollections`, `Orders`, `Users`, `Media`).
- Preserve admin authentication behavior and environment variables.
- Run type generation and import map regeneration in new runtime flow.

- Refactor query access into two layers:
  - `cms-client` (HTTP client for REST/GraphQL).
  - `domain services` (getProducts/getCollections/etc).
- Remove Vinext/frontend dependence on Payload Local API.
- Add typed API responses (zod or generated types).
- Add caching strategy (edge cache + revalidation tags/headers).

Deliverables:
- Payload Admin/API runs without Next.js.
- Frontend can run without importing `payload` package directly.
- Smoke tests passing for product/collection/checkout flows.

## Phase 2 - Bootstrap Vinext App (2-5 days)

- Create Vinext app in parallel workspace (`apps/storefront-vinext`).
- Port route-by-route from `src/app/(frontend)`.
- Port shared UI components first (`src/components/ui`, `src/components/layout`).
- Re-implement data fetching with new `cms-client`.
- Recreate cart state and checkout integration.

Deliverables:
- Functional parity for homepage, listing, product, cart, checkout.

## Phase 3 - Initial Deployment (Chosen Option 2) (1-2 days)

- Configure Vinext Cloudflare deployment using Nitro Cloudflare preset.
- Add environment variables and secret bindings.
- Keep standalone Payload CMS/API deployed on Vercel temporarily.
- Configure custom domain and SSL in Cloudflare.
- Set up cache policy for product/catalog responses.

Deliverables:
- Public Cloudflare URL.
- Production smoke test checklist.

## Phase 4 - Full Cloudflare Migration Target (Optional, 4-10 days)

- Assess CMS runtime compatibility for Cloudflare target (Node APIs, binary deps, adapters, image processing path).
- Replace incompatible components with Cloudflare-friendly alternatives where needed.
- Migrate media from Vercel Blob to Cloudflare R2.
- Move CMS/API off Vercel once parity and reliability are validated.

Deliverables:
- Full Cloudflare-compatible architecture.
- Reduced monthly infra cost.
- No regressions in admin uploads and order writes.

## 6) Work Breakdown by Area

### Frontend Migration Tasks

- Routing/layout parity from Next App Router to Vinext routing conventions.
- Replace Next-specific imports (`next/image`, `next/link`, metadata helpers) with Vinext equivalents.
- Replace Server Actions/Route Handler assumptions with Vinext server functions/Nitro handlers where needed.

### CMS/API Tasks

- Keep current Payload collections unchanged initially:
  - `Products`, `PenCollections`, `Orders`, `Users`, `Media`.
- Expose only required public endpoints for storefront.
- Lock down admin/API with CORS + auth boundaries.

### Storage Tasks

- Stage 1: keep Vercel Blob to reduce migration risk.
- Stage 2: migrate to R2 only after storefront is stable.

## 7) Risks and Mitigations

- Risk: Next-specific frontend APIs create porting friction.
  - Mitigation: route-by-route migration with compatibility wrappers.
- Risk: Payload coupling blocks fully edge-native stack.
  - Mitigation: service split (frontend edge, CMS node).
- Risk: Storage migration causes asset regressions.
  - Mitigation: postpone Blob->R2 until after storefront go-live.
- Risk: SEO/perf regression.
  - Mitigation: benchmark before/after, enforce parity gates.

## 8) Decision Gate (Locked Choices)

Selected by project direction:
- Architecture: **Option B (Full Re-platform)**.
- Initial hosting: **Cloudflare Option 2** (frontend on Cloudflare, CMS on Vercel temporarily).
- Later target: **Cloudflare Option 3** (full Cloudflare runtime).

Execution rule:
- Do not merge migration work unless both storefront parity and standalone Payload parity are green.

## 9) Proposed Milestone Timeline

- Week 1: Phase 0 + Phase 1 (standalone Payload extraction) complete.
- Week 2: Phase 2 storefront parity complete in Vinext.
- Week 3: Phase 3 cutover (Cloudflare frontend + Vercel CMS).
- Week 4-5 (optional): Phase 4 full Cloudflare migration work.

## 10) Definition of Done

- Vinext storefront live on Cloudflare.
- Core commerce flows working (browse -> product -> cart -> checkout -> order persisted).
- Payload admin stable and accessible on standalone runtime (temporarily Vercel-hosted).
- Performance equal or better than current baseline.
- Rollback plan documented and tested.

## 11) Useful References

- Vinext overview: https://github.com/nksaraf/vinext
- Vinext Cloudflare deploy note: https://vinext.io/
- Existing project docs:
  - `README.md`
  - `documentation/Tech-stack-choice.md`
  - `documentation/memory.md`
