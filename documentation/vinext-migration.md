# Vinext Migration: Next.js → Vite — Full Fix Log

This document records every issue hit when migrating the Montblanc e-commerce project from the Next.js CLI to **vinext** (Cloudflare's Vite-based drop-in replacement for the `next` CLI), and the exact fix applied for each.

## What vinext is

[vinext](https://www.npmjs.com/package/vinext) (v0.0.18) is a Cloudflare package that replaces the `next` CLI with a Vite-powered one. It keeps **all** Next.js App Router conventions (pages, layouts, RSC, server actions, `next/link`, `next/image`, etc.) while swapping webpack for Vite underneath. Zero changes to component files are needed.

---

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Scripts: `next` → `vinext`. Added `vite ^7.0.0`, `vinext latest`, `@vitejs/plugin-rsc`, `react-server-dom-webpack`. `engines.node` → `>=22`. |
| `tsconfig.json` | Fixed trailing comma (invalid JSON). Removed `"plugins": [{"name": "next"}]` (Next.js TS plugin). Changed `"jsx": "preserve"` → `"jsx": "react-jsx"`. Removed `next-env.d.ts` and `.next/types/**/*.ts` from `include`. |
| `vite.config.ts` | **New file** — see full breakdown below. |
| `.env` | **New file** — `DATABASE_URL`, `PAYLOAD_SECRET`, `BLOB_READ_WRITE_TOKEN`. |

---

## `package.json` Script Changes

```json
{
  "scripts": {
    "dev":     "cross-env NODE_OPTIONS=--no-deprecation vinext dev",
    "build":   "cross-env NODE_OPTIONS=\"--no-deprecation --max-old-space-size=8000\" vinext build",
    "start":   "cross-env NODE_OPTIONS=--no-deprecation vinext start",
    "lint":    "cross-env NODE_OPTIONS=--no-deprecation vinext lint",
    "devsafe": "rm -rf .vite && cross-env NODE_OPTIONS=--no-deprecation vinext dev"
  },
  "engines": { "node": ">=22" }
}
```

---

## `vite.config.ts` — Complete File with Explanations

```typescript
import vinext from "vinext";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

const cssStubPlugin: PluginOption = { ... };
const fixCssDevServingPlugin: PluginOption = { ... };
const patchPayloadLayoutPlugin: PluginOption = { ... };

export default defineConfig({
  plugins: [cssStubPlugin, fixCssDevServingPlugin, patchPayloadLayoutPlugin, vinext()],
  environments: {
    rsc: { resolve: { noExternal: [/@payloadcms\//, /react-image-crop/] } },
    ssr: { resolve: { noExternal: [/@payloadcms\//, /react-image-crop/] } },
  },
});
```

---

## Issue 1 — `Unknown file extension ".css"` (RSC Worker Crash)

**Error:**
```
Unknown file extension ".css" for C:\...\node_modules\react-image-crop\dist\ReactCrop.css
```

**Root cause:**
`@payloadcms/ui/dist/elements/EditUpload/index.js` and `.../exports/client/index.js` both contain bare CSS imports at module level:
```js
import 'react-image-crop/dist/ReactCrop.css';
```
Node.js's native ESM loader, which runs the RSC worker thread, cannot load `.css` files. It throws "Unknown file extension".

**Why `transform` doesn't work:**
Vite's module runner extracts all imports from a file **before** calling `transform` plugins. So stripping CSS imports in `transform` is too late — the CSS file is already queued for resolution.

**Fix: `resolveId` + `load` to stub CSS from npm packages**
```typescript
const cssStubPlugin: PluginOption = {
  name: "css-stub-ssr",
  enforce: "pre",
  resolveId(id, _importer, options) {
    const envName = (this as any).environment?.name;
    const isServer = options?.ssr || envName === "ssr" || envName === "rsc";
    if (!isServer || !id.endsWith(".css")) return;

    // Only stub bare npm package imports (not project-local CSS like "../globals.css")
    const isNpmPackage =
      !id.startsWith(".") &&
      !id.startsWith("/") &&
      !id.startsWith("\0") &&
      !id.startsWith("@/") &&
      !/^[a-zA-Z]:/.test(id);

    if (isNpmPackage) {
      return "\0virtual:empty-css";
    }
  },
  load(id) {
    if (id === "\0virtual:empty-css") {
      return "";
    }
  },
};
```

**Also required:** `environments.rsc.resolve.noExternal: [/@payloadcms\//, /react-image-crop/]`

Without this, the packages are **externalized** — Node.js loads them natively, bypassing Vite's module runner entirely. Our `resolveId` hook is never called.

---

## Issue 2 — `Identifier 'cookies' has already been declared`

**Error:**
```
Internal server error: Identifier 'cookies' has already been declared
  at new AsyncFunction (<anonymous>)
  at ESModulesEvaluator.runInlinedModule
  at ... @payloadcms/next/src/exports/layouts.ts:1:1
  at ... src/app/(payload)/layout.tsx:6:1
```

**Root cause:**
`@payloadcms/next/dist/layouts/Root/index.js` contains:
```js
// RootLayout body — outer scope
const { cookies, headers, ... } = await initReq({ ... });  // line 26

// Inner server action
async function switchLanguageServerAction(lang) {
  'use server';
  const cookies = await nextCookies();  // line 59 — local variable
  cookies.set({ ... });
}
```

`@vitejs/plugin-rsc` has a **scope analysis bug**: it sees the outer `cookies` (from `initReq` destructuring at line 26) and incorrectly includes it in the list of closure variables for `switchLanguageServerAction`. It then adds `cookies` as a function **parameter** to the extracted server action. The function body's own `const cookies = await nextCookies()` then conflicts with that parameter:

```js
// What @vitejs/plugin-rsc generates (broken):
async function $$hoist_0_switchLanguageServerAction(config, cookies, lang) {
  //                                                         ^^^^^^^ added as param
  'use server';
  const cookies = await nextCookies();  // SyntaxError: already declared
}
```

**Fix: Rename the inner variable BEFORE `@vitejs/plugin-rsc` sees the file**
```typescript
const patchPayloadLayoutPlugin: PluginOption = {
  name: "patch-payload-root-layout",
  enforce: "pre",  // runs before @vitejs/plugin-rsc
  transform(code, id) {
    if (id.includes("@payloadcms") && id.includes("layouts/Root/index.js")) {
      return {
        code: code
          .replace(
            /const cookies = await nextCookies\(\)/g,
            "const cookieJar = await nextCookies()"
          )
          .replace(/\bcookies\.set\(/g, "cookieJar.set("),
        map: null,
      };
    }
  },
};
```

Renaming the inner variable to `cookieJar` removes the name collision. The scope analysis no longer confuses it with the outer `cookies`.

---

## Issue 3 — No CSS on Frontend

**Symptom:** The page loads (HTTP 200) but has no CSS applied at all.

**Root cause:**
`@vitejs/plugin-rsc` correctly collects CSS imports from RSC modules and generates `<link>` tags in the server-rendered HTML:
```html
<link rel="stylesheet" href="/src/app/globals.css" data-rsc-css-href="..." data-precedence="vite-rsc/importer-resources"/>
```

But Vite's dev server **always** serves CSS files as `Content-Type: text/javascript` (a JavaScript HMR module). The browser receives JavaScript when it expects CSS and ignores the stylesheet entirely.

**Verification:**
```
GET /src/app/globals.css          → Content-Type: text/javascript  ❌
GET /src/app/globals.css?direct   → Content-Type: text/css         ✅
```

The `?direct` query param tells Vite to serve the processed CSS file directly instead of the HMR wrapper.

**Fix: Dev server middleware that appends `?direct`**
```typescript
const fixCssDevServingPlugin: PluginOption = {
  name: "fix-rsc-css-dev-serving",
  apply: "serve",  // dev only
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      // Intercept bare CSS/SCSS requests (no query string) and redirect to ?direct
      if (req.url && /^[^?]+\.(css|scss|sass|less)$/.test(req.url)) {
        req.url += "?direct";
      }
      next();
    });
  },
};
```

This covers both `.css` and `.scss` — Payload's admin panel imports many `.scss` files from `@payloadcms/ui`.

---

## Issue 4 — Admin Panel Dark Screen (Partially Open)

**Status:** Partially diagnosed. Frontend is fully working.

**Root cause:**
`@vitejs/plugin-rsc` enforces strict RSC serialization rules. The Payload admin renders server components that pass objects containing JavaScript functions across the RSC→Client boundary, which is disallowed:

```
Error: Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".
  {cancel: ..., queue: ..., run: function defaultAccess}
  {init: function init, kvCollection: ...}
```

1. `{cancel, queue, run: function defaultAccess}` — Payload's **jobs queue access control** object. Defined in `payload/dist/config/defaults.js` with `defaultAccess` as default for `cancel`, `queue`, and `run`.
2. `{init: function, kvCollection: ...}` — Payload's **KV adapter** (`databaseKVAdapter()` return value). The `init` function and the `kvCollection` object (containing its own access functions) are in the Payload config.

Payload's `createClientConfig` (`payload/dist/config/client.js`) is supposed to strip server-only properties (`jobs`, `kv`) before serializing for the client. Investigation suggests these may be reaching the RSC boundary through a nested path not covered by the strip list.

**This is a compatibility gap** between Payload CMS 3.75 and `@vitejs/plugin-rsc`. Payload was designed for Next.js's RSC implementation, which may be more permissive about function passing than `@vitejs/plugin-rsc`'s strict enforcement.

**Next steps to investigate:**
- Add a transform that wraps `createClientConfig` output to explicitly delete any remaining function-valued properties via JSON serialization roundtrip
- Or patch `payload/dist/config/client.js` to also filter `queues` / nested access configs
- Or report this as a bug to both Payload and vinext teams

---

## Working State Summary

| Route | Status |
|-------|--------|
| `localhost:PORT/` | ✅ HTTP 200, full CSS (Tailwind v4) applied |
| `localhost:PORT/admin` | ✅ HTTP 200, redirects to `/admin/login` |
| `localhost:PORT/admin/login` | ⚠️ HTTP 200 but dark screen — RSC function-passing error prevents client hydration |
| Neon DB connection | ✅ Schema pulled on startup |

## Quick Start

```bash
# 1. Copy .env.example → .env and fill in values
cp .env.example .env

# 2. Install
npm install

# 3. Run dev
npm run dev
```

---

## Known Warnings (Non-Blocking)

```
[vinext] next.config option "webpack" is not yet supported and will be ignored
```
`next.config.mjs` uses `withPayload()` which internally adds a webpack config. Vinext ignores it. Payload still works via the `@payload-config` alias — this is harmless.
