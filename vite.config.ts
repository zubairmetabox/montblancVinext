import vinext from "vinext";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

// Stub out bare npm package CSS imports in SSR/RSC environments.
// Payload CMS and react-image-crop import CSS at the module level;
// this causes Node.js's ESM loader to crash with "Unknown file extension '.css'"
// in RSC/SSR worker contexts. We intercept at resolveId (before the file is
// loaded) rather than transform (too late — imports are extracted before transform).
//
// IMPORTANT: Only stub bare npm package specifiers (e.g. "react-image-crop/dist/ReactCrop.css").
// Project-local CSS (relative paths like "../globals.css", or the "@/" alias) must pass
// through Vite's normal CSS pipeline so that Tailwind/PostCSS is applied and a
// <link> tag is injected into the SSR HTML.
const cssStubPlugin: PluginOption = {
  name: "css-stub-ssr",
  enforce: "pre",
  resolveId(id, _importer, options) {
    const envName = (this as any).environment?.name;
    const isServer = options?.ssr || envName === "ssr" || envName === "rsc";
    if (!isServer || !id.endsWith(".css")) return;

    // Bare npm package import: doesn't start with ".", "/", "\0", "@/" or a drive letter.
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

// @vitejs/plugin-rsc generates <link rel="stylesheet" href="/src/app/globals.css">
// in the server-rendered HTML. But Vite's dev server wraps CSS files in a
// JavaScript HMR module (Content-Type: text/javascript), so the browser receives
// JS instead of CSS and ignores the stylesheet.
//
// Fix: intercept browser requests for bare .css URLs (no query params) and
// append "?direct" — which tells Vite to serve the raw processed CSS content
// (Content-Type: text/css) instead of the HMR wrapper.
const fixCssDevServingPlugin: PluginOption = {
  name: "fix-rsc-css-dev-serving",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^[^?]+\.(css|scss|sass|less)$/.test(req.url)) {
        req.url += "?direct";
      }
      next();
    });
  },
};

// @vitejs/plugin-rsc has a scope-analysis bug: it incorrectly treats the outer
// `cookies` (destructured from initReq at line 26 of Root/index.js) as a
// closure variable inside switchLanguageServerAction, which causes it to be
// added as a function parameter. The inner `const cookies = await nextCookies()`
// then conflicts with that parameter → SyntaxError: Identifier already declared.
//
// Fix: rename the inner variable before @vitejs/plugin-rsc performs its analysis,
// so there is no name collision that confuses the scope tracker.
const patchPayloadLayoutPlugin: PluginOption = {
  name: "patch-payload-root-layout",
  enforce: "pre",
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

export default defineConfig({
  plugins: [cssStubPlugin, fixCssDevServingPlugin, patchPayloadLayoutPlugin, vinext()],
  environments: {
    rsc: {
      resolve: {
        noExternal: [/@payloadcms\//, /react-image-crop/],
      },
    },
    ssr: {
      resolve: {
        noExternal: [/@payloadcms\//, /react-image-crop/],
      },
    },
  },
});
