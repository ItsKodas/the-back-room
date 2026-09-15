# Installable Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make The Back Room installable to a phone's home screen (Android, iPhone, desktop) as a full-screen app, without building or shipping a native app.

**Architecture:** The site itself becomes the app. A hand-written service worker in `apps/web/public/sw.js` keeps Vite's hashed build files on the device and falls back to an offline page when navigation fails; it never touches the API, auth, socket or card routes. The client registers it in production, offers an Install button in the navbar (the browser's own prompt on Android/desktop, a Share → Add to Home Screen hint on iOS), fits itself around the notch, and recovers its socket and audio when an installed app is brought back from the background.

**Tech Stack:** TypeScript, React 18, Vite, socket.io-client, Express (`express.static`), Vitest (node and jsdom environments) + Testing Library, Biome.

**Spec:** None written separately — the design was agreed in conversation and is summarised under **Design** below.

## Global Constraints

- Read `CLAUDE.md` before starting. Comments say why, not what, in the voice of the surrounding code.
- The service worker never answers for `/api`, `/auth`, `/socket.io`, `/og` or `/healthz` — the same list `CLIENT_ROUTE` in `apps/server/src/server.ts` excludes. Balances, sign-in and the table are always the network's.
- Page navigations are network-first. The server rewrites each page's head per address, so a cached page is only ever the offline fallback, never a substitute.
- The offline page shows no chips, no seat and no table state — it cannot know them, and never invents a fact.
- The service worker is registered only in production builds (`import.meta.env.PROD`).
- Hover reveals nothing: the iOS install hint opens on a press.
- Every new keyframe has a `prefers-reduced-motion: reduce` off switch.
- Check at 375px wide; nothing scrolls sideways.
- `apps/web/public` is excluded from Biome and from `tsc`, so `sw.js` is plain JavaScript checked only by its test. Keep it small.
- After editing: `npx biome format --write <files you touched>` — **never** `biome check --write`. (`sw.js` and `offline.html` are outside Biome's scope; leave them as written.)
- Before adding CSS, confirm the stylesheet is imported: `game.css` and `global.css` are both imported from `apps/web/src/main.tsx`.
- `npm test`, `npm run typecheck`, `npm run lint` clean before each commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Design

- **Nothing is compiled or submitted to a store.** Players install from the browser; every deploy updates the installed app.
- **Caching:** `/assets/*` (Vite's content-hashed output) is cache-first, trimmed to the newest 80 entries. `/offline.html` is precached at install. Everything else passes straight through to the network.
- **Updates:** the worker calls `skipWaiting()` and `clients.claim()`. Because pages are network-first and assets are hashed, a new worker taking over cannot serve a mismatched page, so there is no "new version" prompt.
- **Install offer:** `beforeinstallprompt` is captured and replayed from our own button; `appinstalled` or `display-mode: standalone` hides it. iOS never fires that event, so iOS gets a press-to-open hint, dismissible for good.
- **Returning from the background:** if the socket is down, reconnect at once. If it claims to be up but the app was hidden for at least 45 seconds — socket.io's default 25s ping interval plus 20s ping timeout, after which the server has certainly let it go — force a fresh connection so the existing `lobby:resume` reclaims the seat. Audio resumes on any later touch, because iOS suspends the `AudioContext` whenever the app is put away.
- **Known risk, not solved here:** Discord sign-in from an iOS home-screen app may finish in a Safari sheet whose cookie jar is not the app's. Task 8 checks it on a real iPhone. If it fails, that becomes its own design (e.g. a one-time sign-in code handed from Safari to the app), not a patch inside this plan.

---

## File map

| File | Responsibility |
|---|---|
| `apps/web/public/sw.js` (new) | The service worker: precache the offline page, cache hashed assets, network-first navigations, pass everything else through |
| `apps/web/public/offline.html` (new) | Self-contained offline page, no external requests |
| `apps/web/src/pwa/sw.test.ts` (new) | Runs the real `sw.js` against a fake worker scope |
| `apps/server/src/server.ts` | `sw.js` served with `Cache-Control: no-cache` |
| `apps/server/src/shell.test.ts` | Header test against a served client directory |
| `apps/web/src/pwa/register.ts` (new) | `registerServiceWorker(enabled, container?)` |
| `apps/web/src/pwa/register.test.ts` (new) | Registration tests |
| `apps/web/src/main.tsx` | Calls `registerServiceWorker(import.meta.env.PROD)` |
| `apps/web/src/nav/useInstall.ts` (new) | `useInstall()`, `isStandalone()`, `isIos()` |
| `apps/web/src/nav/Install.tsx` (new) | The Install button and iOS hint |
| `apps/web/src/nav/Install.test.tsx` (new) | Install UI tests |
| `apps/web/src/nav/Navbar.tsx` | Renders `<Install />` |
| `apps/web/src/game/game.css` | `.install` and `.install__hint` styles |
| `apps/web/index.html` | `viewport-fit=cover`, standalone and status-bar meta |
| `apps/web/public/site.webmanifest` | `shortcuts` |
| `apps/web/src/global.css` | Safe-area padding on `#root` |
| `apps/web/src/head.test.ts` | Tests for the head, manifest shortcuts and safe-area rule |
| `apps/web/src/net/wake.ts` (new) | `rejoinOnReturn(socket, page?, now?)` |
| `apps/web/src/net/wake.test.ts` (new) | Rejoin tests |
| `apps/web/src/game/useRoom.ts` | Wires `rejoinOnReturn` |
| `apps/web/src/table/useTableSocket.ts` | Wires `rejoinOnReturn` |
| `apps/web/src/game/audio.ts` | Resume a suspended context on any touch |
| `apps/web/src/game/audioResume.test.ts` (new) | Audio resume tests |

---

### Task 1: The service worker and offline page

**Files:**
- Create: `apps/web/public/sw.js`
- Create: `apps/web/public/offline.html`
- Test: `apps/web/src/pwa/sw.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a worker at `/sw.js` (registered by Task 3); caches named `backroom-shell-v1` and `backroom-assets`; the page `/offline.html`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pwa/sw.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * The real worker, run against a fake scope.
 *
 * `public/` is outside both Biome and tsc, so this test is the only thing that
 * reads `sw.js` before a phone does — and a worker that answers for the wrong
 * request fails silently: a balance served from a cache looks exactly like a
 * balance.
 */

const source = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
const ORIGIN = "https://backroom.test";

type Listener = (event: unknown) => void;
interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

function boot(network: (request: FakeRequest) => Promise<Response>) {
  const listeners = new Map<string, Listener>();
  const stored = new Map<string, Map<string, Response>>();
  const box = (name: string) => {
    const found = stored.get(name) ?? new Map<string, Response>();
    stored.set(name, found);
    return found;
  };
  const href = (request: FakeRequest | string) =>
    typeof request === "string" ? new URL(request, ORIGIN).href : request.url;

  const caches = {
    open: async (name: string) => {
      const entries = box(name);
      return {
        match: async (request: FakeRequest | string) => entries.get(href(request))?.clone(),
        put: async (request: FakeRequest, response: Response) => {
          entries.set(request.url, response);
        },
        addAll: async (paths: string[]) => {
          for (const path of paths) {
            entries.set(href(path), new Response(`cached ${path}`));
          }
        },
        keys: async () => [...entries.keys()].map((url) => ({ url })),
        delete: async (request: FakeRequest) => entries.delete(request.url),
      };
    },
    match: async (request: string) => {
      for (const entries of stored.values()) {
        const hit = entries.get(href(request));
        if (hit !== undefined) {
          return hit.clone();
        }
      }
      return undefined;
    },
    keys: async () => [...stored.keys()],
    delete: async (name: string) => stored.delete(name),
  };
  const scope = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetch = vi.fn(network);
  new Function("self", "caches", "fetch", source)(scope, caches, fetch);

  /** Runs a lifecycle event and waits for whatever it asked to be waited on. */
  const lifecycle = async (type: "install" | "activate") => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  };

  /** What the worker does with a request: its answer, or "network" if it stayed out of it. */
  const ask = async (path: string, init: { method?: string; mode?: string } = {}) => {
    const request: FakeRequest = {
      url: new URL(path, ORIGIN).href,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
    };
    let answer: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request,
      respondWith: (response: Promise<Response>) => {
        answer = Promise.resolve(response);
      },
    });
    return answer === undefined ? "network" : await answer;
  };

  return { fetch, stored, lifecycle, ask };
}

const ok = async () => new Response("from the network");

describe("what the worker keeps its hands off", () => {
  it("never answers for the API, sign-in, the socket, the cards or the health check", async () => {
    const sw = boot(ok);
    for (const path of ["/api/me", "/auth/discord", "/socket.io/?EIO=4", "/og/site.png", "/healthz"]) {
      expect(await sw.ask(path), path).toBe("network");
    }
  });

  it("stays out of sign-in even when it is a page navigation", async () => {
    // /auth/discord is followed as a navigation, and navigations are otherwise
    // the worker's — so this is the one the exclusion has to beat.
    const sw = boot(ok);
    expect(await sw.ask("/auth/discord", { mode: "navigate" })).toBe("network");
  });

  it("leaves anything that is not a GET alone", async () => {
    const sw = boot(ok);
    expect(await sw.ask("/assets/index-abc123.js", { method: "POST" })).toBe("network");
  });

  it("leaves other origins alone", async () => {
    const sw = boot(ok);
    expect(await sw.ask("https://fonts.googleapis.com/css2?family=Bevan")).toBe("network");
  });
});

describe("pages", () => {
  it("come from the network while there is one", async () => {
    const sw = boot(ok);
    await sw.lifecycle("install");
    const answer = await sw.ask("/blackjack", { mode: "navigate" });
    expect(answer).not.toBe("network");
    expect(await (answer as Response).text()).toBe("from the network");
  });

  it("fall back to the offline page when there is not", async () => {
    const sw = boot(async () => {
      throw new TypeError("Failed to fetch");
    });
    await sw.lifecycle("install");
    const answer = await sw.ask("/blackjack", { mode: "navigate" });
    expect(await (answer as Response).text()).toBe("cached /offline.html");
  });
});

describe("the build's own files", () => {
  it("are fetched once and then served from the device", async () => {
    const sw = boot(ok);
    await sw.ask("/assets/index-abc123.js");
    await sw.ask("/assets/index-abc123.js");
    expect(sw.fetch).toHaveBeenCalledTimes(1);
  });

  it("are not kept when the server did not actually send them", async () => {
    const sw = boot(async () => new Response("gone", { status: 404 }));
    await sw.ask("/assets/index-old.js");
    await sw.ask("/assets/index-old.js");
    expect(sw.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("taking over", () => {
  it("clears out caches an older worker left behind", async () => {
    const sw = boot(ok);
    sw.stored.set("backroom-shell-v0", new Map());
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
    expect([...sw.stored.keys()]).not.toContain("backroom-shell-v0");
    expect([...sw.stored.keys()]).toContain("backroom-shell-v1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/pwa/sw.test.ts`
Expected: FAIL — `ENOENT: no such file or directory` for `public/sw.js`.

- [ ] **Step 3: Write the worker**

Create `apps/web/public/sw.js`:

```js
/*
 * The Back Room, installed.
 *
 * Deliberately small, and deliberately ignorant of the game. Everything a
 * player's evening depends on — chips, seats, sign-in — belongs to the server
 * and goes straight to it; a copy of any of those served from a cache would be
 * a fact invented on the server's behalf. What this keeps is the building's
 * furniture: the hashed build files, which can never go stale because a new
 * build gives them new names, and a page to show when there is no network at
 * all.
 */

const SHELL = "backroom-shell-v1";
const ASSETS = "backroom-assets";
const OFFLINE = "/offline.html";
/** Enough for a build or two; older hashed files are dead weight after a deploy. */
const ASSET_LIMIT = 80;
/** The same doors CLIENT_ROUTE keeps the page handler away from, on the server. */
const NEVER = /^\/(?:api|auth|socket\.io|og|healthz)(?:\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== SHELL && name !== ASSETS).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    // Network first, always: the server writes each page's head for its own
    // address, and a table's goes stale as its seats fill.
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE).then((page) => page ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(fromDevice(request));
  }
});

async function fromDevice(request) {
  const cache = await caches.open(ASSETS);
  const kept = await cache.match(request);
  if (kept !== undefined) {
    return kept;
  }
  const response = await fetch(request);
  // A 404 for an old build's file is not the file, and keeping it would serve
  // the error forever.
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  const surplus = keys.length - ASSET_LIMIT;
  for (const key of keys.slice(0, Math.max(0, surplus))) {
    await cache.delete(key);
  }
}
```

- [ ] **Step 4: Write the offline page**

Create `apps/web/public/offline.html`. Self-contained on purpose: when this shows, nothing else can be fetched, including the fonts and the stylesheet.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0d1015" />
    <title>The Back Room — offline</title>
    <!--
      Everything inline, because this page exists for the moment nothing else
      can be fetched. It says nothing about chips or tables: it cannot know
      them, and a stale number shown here would be a fact the server never said.
    -->
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
          max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
        box-sizing: border-box;
        /* tokens.css values copied by hand: this page cannot load the stylesheet. */
        background: radial-gradient(85% 62% at 50% 104%, #12241f 0%, transparent 78%), #0f141c;
        color: #dfe7f2;
        font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        text-align: center;
      }
      h1 { margin: 0 0 8px; font-size: 1.6rem; font-weight: 600; }
      p { margin: 0 0 20px; color: #8b97a8; }
      button {
        min-height: 44px;
        padding: 0 22px;
        border: 1px solid #2e7bff;
        border-radius: 4px;
        background: transparent;
        color: #7ba9ff;
        font: inherit;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>The room's dark.</h1>
      <p>You're offline. The tables are still here when you're back.</p>
      <button type="button" onclick="location.reload()">Try again</button>
    </main>
    <script>
      // Coming back online is the answer this page is waiting for.
      window.addEventListener("online", () => location.reload());
    </script>
  </body>
</html>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/web/src/pwa/sw.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
npx biome format --write apps/web/src/pwa/sw.test.ts
git add apps/web/public/sw.js apps/web/public/offline.html apps/web/src/pwa/sw.test.ts
git commit -m "feat(web): a service worker that keeps the build and never the table" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Serve the worker uncached

**Files:**
- Modify: `apps/server/src/server.ts:1317` (the `express.static` line) and its `node:path` import
- Test: `apps/server/src/shell.test.ts`

**Interfaces:**
- Consumes: `/sw.js` existing in the client build (Task 1). The test writes its own copy.
- Produces: `GET /sw.js` answers with `Cache-Control: no-cache`; other static files keep `express.static`'s default.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/shell.test.ts`:

```ts
describe("the service worker", () => {
  it("is never served from a cache, so a deploy reaches phones that installed the app", async () => {
    /*
     * A browser checks for a new worker by fetching this file — and the HTTP
     * cache, or anything in front of the server, can answer that check with
     * the old copy. A fix then sits unseen on every installed phone.
     */
    writeFileSync(join(dist, "sw.js"), "// worker", "utf8");
    const answer = await fetch(`http://127.0.0.1:${port}/sw.js`);

    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-cache");
  });

  it("leaves every other file's caching as it was", async () => {
    writeFileSync(join(dist, "favicon.svg"), "<svg/>", "utf8");
    const answer = await fetch(`http://127.0.0.1:${port}/favicon.svg`);

    expect(answer.headers.get("cache-control")).not.toBe("no-cache");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/src/shell.test.ts`
Expected: FAIL — `expected 'public, max-age=0' to be 'no-cache'`.

- [ ] **Step 3: Implement**

In `apps/server/src/server.ts`, add `basename` to the existing `node:path` import. Then replace the line

```ts
    app.use(express.static(clientDist, { index: false }));
```

with

```ts
    app.use(
      express.static(clientDist, {
        index: false,
        /*
         * The worker, and only the worker, is always re-checked. A browser looks
         * for a new one by fetching this file, and a cached answer to that is an
         * installed app that never hears about a deploy.
         */
        setHeaders: (response, path) => {
          if (basename(path) === "sw.js") {
            response.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/server/src/shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/server/src/server.ts apps/server/src/shell.test.ts
npm run typecheck
git add apps/server/src/server.ts apps/server/src/shell.test.ts
git commit -m "feat(server): serve the service worker uncached" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Register the worker in production

**Files:**
- Create: `apps/web/src/pwa/register.ts`
- Modify: `apps/web/src/main.tsx`
- Test: `apps/web/src/pwa/register.test.ts`

**Interfaces:**
- Consumes: `/sw.js` (Task 1).
- Produces: `registerServiceWorker(enabled: boolean, container?: Pick<ServiceWorkerContainer, "register">): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pwa/register.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register.js";

const container = () => ({ register: vi.fn(async () => ({}) as ServiceWorkerRegistration) });

describe("registering the worker", () => {
  it("does nothing outside a production build", () => {
    const workers = container();
    registerServiceWorker(false, workers);
    window.dispatchEvent(new Event("load"));
    expect(workers.register).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without service workers", () => {
    expect(() => registerServiceWorker(true, undefined)).not.toThrow();
  });

  it("registers the worker at the root, once, whether or not the page had finished loading", () => {
    // The load is dispatched either way: if the page was already complete the
    // worker registered at once and no listener is waiting, so it stays one.
    const workers = container();
    registerServiceWorker(true, workers);
    window.dispatchEvent(new Event("load"));
    expect(workers.register).toHaveBeenCalledTimes(1);
    expect(workers.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does not turn a refused registration into an error on the page", async () => {
    const refusing = { register: vi.fn(async () => Promise.reject(new Error("insecure"))) };
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    registerServiceWorker(true, refusing);
    window.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refusing.register).toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/pwa/register.test.ts`
Expected: FAIL — `Failed to resolve import "./register.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/pwa/register.ts`:

```ts
/**
 * Hands the page to the service worker.
 *
 * Production only. In development Vite serves the client from its own server,
 * and a worker left behind on localhost by a `vite preview` would keep answering
 * with an offline page whenever the dev server happened to be down — a stale
 * page nobody asked for, on the one machine where it would be most confusing.
 *
 * After load, so fetching and parsing the worker never competes with the
 * room's first paint on a slow phone.
 */
export function registerServiceWorker(
  enabled: boolean,
  container: Pick<ServiceWorkerContainer, "register"> | undefined = navigator.serviceWorker,
): void {
  if (!enabled || container === undefined) {
    return;
  }
  const register = () => {
    // A refusal — an insecure origin, a private window — leaves the site
    // exactly as it was, which is a website. Nothing to tell anybody.
    container.register("/sw.js").catch(() => {});
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
```

In `apps/web/src/main.tsx`, add the import after `import App from "./App.js";`:

```ts
import { registerServiceWorker } from "./pwa/register.js";
```

and after the `createRoot(container).render(...)` call:

```ts
registerServiceWorker(import.meta.env.PROD);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/pwa/register.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/pwa/register.ts apps/web/src/pwa/register.test.ts apps/web/src/main.tsx
npm run typecheck
git add apps/web/src/pwa/register.ts apps/web/src/pwa/register.test.ts apps/web/src/main.tsx
git commit -m "feat(web): register the service worker in production" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The Install button

**Files:**
- Create: `apps/web/src/nav/useInstall.ts`
- Create: `apps/web/src/nav/Install.tsx`
- Modify: `apps/web/src/nav/Navbar.tsx` (render `<Install />` before `<Sound />`)
- Modify: `apps/web/src/game/game.css` (append an install section)
- Test: `apps/web/src/nav/Install.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks. The button works without the worker, but Chrome only offers installation once Task 3 has shipped.
- Produces: `type InstallOffer = { kind: "prompt"; install: () => void } | { kind: "ios" } | { kind: "none" }`; `useInstall(): InstallOffer`; `isStandalone(win?: Window): boolean`; `isIos(userAgent: string, maxTouchPoints: number): boolean`; `<Install />`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/nav/Install.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Install } from "./Install.js";
import { isIos } from "./useInstall.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function offerFromBrowser() {
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("on a browser that can install", () => {
  it("offers nothing until the browser says it can", () => {
    render(<Install />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("offers Install once it can, and hands the press to the browser's own prompt", async () => {
    render(<Install />);
    const { event, prompt } = offerFromBrowser();

    // Held back, so the browser's mini-infobar does not appear on its own.
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalledTimes(1);

    // A prompt can be used once; after the choice the button has nothing to do.
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("goes away once the app is installed", () => {
    render(<Install />);
    offerFromBrowser();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("offers nothing inside the installed app itself", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<Install />);
    offerFromBrowser();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });
});

describe("on an iPhone", () => {
  beforeEach(() => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
  });

  it("explains how on a press, because iOS has no prompt to give", () => {
    render(<Install />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    const hint = screen.getByRole("dialog", { name: "Install The Back Room" });
    expect(hint.textContent).toContain("Add to Home Screen");
  });

  it("stays dismissed once somebody has said they have got it", () => {
    const { unmount } = render(<Install />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();

    unmount();
    render(<Install />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });
});

describe("telling an iPhone or iPad apart", () => {
  it("knows an iPhone", () => {
    expect(isIos(IPHONE, 5)).toBe(true);
  });

  it("knows an iPad that is pretending to be a Mac", () => {
    expect(isIos(IPAD_AS_MAC, 5)).toBe(true);
  });

  it("does not mistake an actual Mac for one", () => {
    expect(isIos(IPAD_AS_MAC, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/nav/Install.test.tsx`
Expected: FAIL — `Failed to resolve import "./Install.js"`.

- [ ] **Step 3: Write the hook**

Create `apps/web/src/nav/useInstall.ts`:

```ts
import { useEffect, useState } from "react";

/** What this browser can do about putting the room on a home screen. */
export type InstallOffer = { kind: "prompt"; install: () => void } | { kind: "ios" } | { kind: "none" };

/** Chrome's install event. Not in the DOM typings because it is not a standard. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Whether this page is already running as the installed app. */
export function isStandalone(win: Window = window): boolean {
  return (
    win.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (win.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Whether this is an iPhone or iPad.
 *
 * An iPad has said it is a Mac since iPadOS 13, so the user agent alone cannot
 * tell. A Mac has no touch screen, and that is the difference.
 */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * The install offer, as it stands.
 *
 * Chrome's event is caught and held rather than left to show its own bar, so
 * the offer lives on our button — somewhere a player will find it again — and
 * not in a banner that shows once and is dismissed on the way to a table.
 */
export function useInstall(): InstallOffer {
  const [held, setHeld] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const offered = (event: Event) => {
      event.preventDefault();
      setHeld(event as InstallPromptEvent);
    };
    const done = () => {
      setInstalled(true);
      setHeld(null);
    };
    window.addEventListener("beforeinstallprompt", offered);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", offered);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed) {
    return { kind: "none" };
  }
  if (held !== null) {
    return {
      kind: "prompt",
      install: () => {
        void held.prompt();
        // A prompt is good for one use, whichever way it was answered.
        void held.userChoice.then(() => setHeld(null));
      },
    };
  }
  if (isIos(window.navigator.userAgent, window.navigator.maxTouchPoints)) {
    return { kind: "ios" };
  }
  return { kind: "none" };
}
```

- [ ] **Step 4: Write the button**

Create `apps/web/src/nav/Install.tsx`:

```tsx
import { useState } from "react";
import { useInstall } from "./useInstall.js";

const DISMISSED = "backroom:install-hint-dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED) === "true";
  } catch {
    return false;
  }
}

/**
 * Putting the room on a home screen.
 *
 * Absent unless there is actually something to do: no browser support, or
 * already installed, is nothing on the bar rather than a control that fails.
 * iOS has no prompt to hand over, so there the press opens the two steps
 * instead — on a press, because a phone has no hover to reveal it with.
 */
export function Install() {
  const offer = useInstall();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (offer.kind === "prompt") {
    return (
      <button type="button" className="btn btn--ghost btn--small" onClick={offer.install}>
        Install
      </button>
    );
  }
  if (offer.kind === "none" || dismissed) {
    return null;
  }
  return (
    <span className="install">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Install
      </button>
      {open ? (
        <span className="install__hint" role="dialog" aria-label="Install The Back Room">
          <span>
            Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISSED, "true");
              } catch {
                // Private mode: it goes for this visit, which is still an answer.
              }
              setDismissed(true);
            }}
          >
            Got it
          </button>
        </span>
      ) : null}
    </span>
  );
}

/** Apple's share glyph, so the instruction matches what is on the screen. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <polyline points="8 7 12 3 16 7" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
```

- [ ] **Step 5: Put it on the bar**

In `apps/web/src/nav/Navbar.tsx`, add `import { Install } from "./Install.js";` beside the `CopyCode` and `Sound` imports. Then change

```tsx
      <Sound />
```

to

```tsx
      <Install />
      <Sound />
```

- [ ] **Step 6: Style the hint**

Append to `apps/web/src/game/game.css`, which is imported from `main.tsx`:

```css
/* ----------------------------------------------------------------- install
 *
 * The hint drops from the button that opened it, which is where the eye
 * already is. Capped to the screen, so on a 375px phone it never pushes the
 * bar sideways.
 */
.install {
  position: relative;
}

.install__hint {
  position: absolute;
  top: calc(100% + var(--gr-space-2));
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gr-space-2);
  width: min(260px, calc(100vw - 2 * var(--gr-space-4)));
  padding: var(--gr-space-3);
  border: var(--gr-edge-hair);
  border-radius: var(--gr-radius-md);
  background: var(--gr-color-night);
  color: var(--gr-color-ink);
  font-size: var(--gr-text-sm);
  transform-origin: top right;
  animation: install-hint-in 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.install__hint svg {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
}

@keyframes install-hint-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.96);
  }
}

@media (prefers-reduced-motion: reduce) {
  .install__hint {
    animation: none;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/nav`
Expected: PASS — `Install.test.tsx` (9 tests) and the existing `Navbar.test.tsx`.

- [ ] **Step 8: Commit**

```bash
npx biome format --write apps/web/src/nav/useInstall.ts apps/web/src/nav/Install.tsx apps/web/src/nav/Install.test.tsx apps/web/src/nav/Navbar.tsx
npm run typecheck
npm run lint
git add apps/web/src/nav/useInstall.ts apps/web/src/nav/Install.tsx apps/web/src/nav/Install.test.tsx apps/web/src/nav/Navbar.tsx apps/web/src/game/game.css
git commit -m "feat(web): an Install button on the bar, and the two steps on iOS" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Fit the screen when installed

**Files:**
- Modify: `apps/web/index.html` (viewport meta; new meta beside `apple-mobile-web-app-title`)
- Modify: `apps/web/public/site.webmanifest` (add `shortcuts`)
- Modify: `apps/web/src/global.css` (append `#root` safe-area rule)
- Test: `apps/web/src/head.test.ts`

**Interfaces:**
- Consumes: routes `/blackjack`, `/slots` and `/greed` in `apps/web/src/App.tsx`.
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/head.test.ts`, widen the manifest type to include `shortcuts?: { name: string; url: string }[];`, add `const app = read("./App.tsx");` and `const globalCss = read("./global.css");` beside the other reads, and append:

```ts
describe("what the installed app looks like", () => {
  it("draws edge to edge, so the room's colour runs under the notch", () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  });

  it("opens without the browser around it, on iOS as well", () => {
    // iOS reads neither the manifest's display nor Android's tag.
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
  });

  it("keeps the page clear of the notch and the home bar it now runs under", () => {
    // Drawing edge to edge without this puts the navbar behind the status bar.
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(globalCss).toContain(`env(safe-area-inset-${side}`);
    }
  });

  it("offers shortcuts only to pages that exist", () => {
    /*
     * A long-press on the icon opens these straight away, and nothing checks
     * them: a renamed route leaves a shortcut to "No such page."
     */
    const shortcuts = manifest.shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of shortcuts) {
      expect(app, shortcut.url).toContain(`<Route path="${shortcut.url}"`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/head.test.ts`
Expected: FAIL — 4 failures in "what the installed app looks like".

- [ ] **Step 3: Update the head**

In `apps/web/index.html`, replace

```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
```

with

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

and immediately after `<meta name="apple-mobile-web-app-title" content="Back Room" />` add, outside the `<!--meta-->` markers because they are the building's rather than any one address's:

```html
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <!--
      Translucent so the room's own dark shows through the status bar rather
      than a white strip; global.css pads the page clear of it.
    -->
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- [ ] **Step 4: Add shortcuts to the manifest**

In `apps/web/public/site.webmanifest`, add after `"categories"`:

```json
  "shortcuts": [
    { "name": "Blackjack", "url": "/blackjack", "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }] },
    { "name": "Slots", "url": "/slots", "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }] },
    { "name": "Greed", "url": "/greed", "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }] }
  ],
```

- [ ] **Step 5: Pad the page clear of the notch**

Append to `apps/web/src/global.css`:

```css
/*
 * Clear of the notch and the home bar.
 *
 * The page draws under both once it is installed (viewport-fit=cover, and a
 * translucent status bar), which is what lets the room's colour reach the
 * edges. The insets are zero in an ordinary browser tab, so this changes
 * nothing there.
 */
#root {
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)
    env(safe-area-inset-left, 0px);
}
```

- [ ] **Step 6: Check anything pinned to the bottom edge**

Run: `rg -n "position: fixed|position: sticky" apps/web/src --glob "*.css"`

For each rule that also sets `bottom:` and holds a control a player presses (not `.haze`, which is decoration), change `bottom: X` to `bottom: calc(X + env(safe-area-inset-bottom, 0px))`. Fixed elements ignore `#root`'s padding, so without this the home bar sits on top of them. If nothing matches, there is nothing to change.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/head.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx biome format --write apps/web/src/head.test.ts
git add apps/web/index.html apps/web/public/site.webmanifest apps/web/src/global.css apps/web/src/head.test.ts
git commit -m "feat(web): fit the installed app around the notch, with shortcuts" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Add any CSS files changed in Step 6 to the `git add`.

---

### Task 6: Rejoin the table when the app comes back

**Files:**
- Create: `apps/web/src/net/wake.ts`
- Modify: `apps/web/src/game/useRoom.ts:194-199` and `:279-282`
- Modify: `apps/web/src/table/useTableSocket.ts:155-161` and `:213-216`
- Test: `apps/web/src/net/wake.test.ts`

**Interfaces:**
- Consumes: the existing `connect` handlers in both hooks, which already send `lobby:resume` for a stored seat.
- Produces: `SERVER_FORGETS_AFTER_MS = 45_000`; `interface Rejoinable { readonly connected: boolean; connect(): unknown; disconnect(): unknown }`; `rejoinOnReturn(socket: Rejoinable, page?: Document, now?: () => number): () => void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/net/wake.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { rejoinOnReturn, SERVER_FORGETS_AFTER_MS } from "./wake.js";

function page() {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  target.visibilityState = "visible";
  const become = (state: DocumentVisibilityState) => {
    target.visibilityState = state;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  return { doc: target as unknown as Document, become };
}

function socket(connected: boolean) {
  const calls: string[] = [];
  return {
    calls,
    connected,
    connect: vi.fn(() => calls.push("connect")),
    disconnect: vi.fn(() => calls.push("disconnect")),
  };
}

describe("coming back to the app", () => {
  it("leaves a connection alone after a glance away", () => {
    const { doc, become } = page();
    const live = socket(true);
    let clock = 0;
    rejoinOnReturn(live, doc, () => clock);

    become("hidden");
    clock = 5_000;
    become("visible");

    expect(live.calls).toEqual([]);
  });

  it("starts a fresh connection after long enough that the server has let the old one go", () => {
    /*
     * A phone freezes a backgrounded app without closing its socket, so the
     * client can come back sure it is connected to a server that dropped it a
     * minute ago — and wait out a whole ping timeout before admitting it.
     */
    const { doc, become } = page();
    const live = socket(true);
    let clock = 0;
    rejoinOnReturn(live, doc, () => clock);

    become("hidden");
    clock = SERVER_FORGETS_AFTER_MS;
    become("visible");

    expect(live.calls).toEqual(["disconnect", "connect"]);
  });

  it("reconnects at once when the connection is already down, however short the absence", () => {
    const { doc, become } = page();
    const down = socket(false);
    let clock = 0;
    rejoinOnReturn(down, doc, () => clock);

    become("hidden");
    clock = 1_000;
    become("visible");

    expect(down.calls).toEqual(["connect"]);
  });

  it("does nothing once the table has been left", () => {
    const { doc, become } = page();
    const down = socket(false);
    const stop = rejoinOnReturn(down, doc, () => 0);

    stop();
    become("hidden");
    become("visible");

    expect(down.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/net/wake.test.ts`
Expected: FAIL — `Failed to resolve import "./wake.js"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/net/wake.ts`:

```ts
/**
 * How long the server keeps a silent socket: socket.io's default ping interval
 * (25s) plus its ping timeout (20s). Past this the server has certainly
 * dropped the connection, so starting a new one loses nothing the old one
 * still had.
 */
export const SERVER_FORGETS_AFTER_MS = 45_000;

export interface Rejoinable {
  readonly connected: boolean;
  connect(): unknown;
  disconnect(): unknown;
}

/**
 * Gets a table's socket back on its feet when the page comes back into view.
 *
 * An installed app is put away far more often than a tab is closed, and a
 * phone freezes it rather than ending it. The socket then comes back believing
 * it is connected to a server that has already let it go, and says nothing
 * until its own ping times out — the better part of a minute of a table that
 * looks live and does not move. A fresh connection runs the hook's own
 * `connect` handler, which reclaims the seat.
 *
 * Returns the way to stop, which has to run before the socket is closed so
 * that a page coming back into view cannot reopen a table somebody has left.
 */
export function rejoinOnReturn(
  socket: Rejoinable,
  page: Document = document,
  now: () => number = Date.now,
): () => void {
  let hiddenAt: number | null = null;

  const changed = () => {
    if (page.visibilityState === "hidden") {
      hiddenAt = now();
      return;
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (!socket.connected) {
      socket.connect();
      return;
    }
    if (away >= SERVER_FORGETS_AFTER_MS) {
      socket.disconnect();
      socket.connect();
    }
  };

  page.addEventListener("visibilitychange", changed);
  return () => page.removeEventListener("visibilitychange", changed);
}
```

- [ ] **Step 4: Wire it into both socket hooks**

In `apps/web/src/game/useRoom.ts`, add `import { rejoinOnReturn } from "../net/wake.js";` beside the `windowId` import. After `socketRef.current = socket;` in the socket effect add:

```ts
    const stopRejoining = rejoinOnReturn(socket);
```

and change the effect's cleanup from

```ts
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);
```

to

```ts
    return () => {
      stopRejoining();
      socket.close();
      socketRef.current = null;
    };
  }, []);
```

In `apps/web/src/table/useTableSocket.ts`, add the same import beside `windowId`. After `socketRef.current = socket;` add:

```ts
    const stopRejoining = rejoinOnReturn(socket);
```

and change

```ts
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [game]);
```

to

```ts
    return () => {
      stopRejoining();
      socket.close();
      socketRef.current = null;
    };
  }, [game]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/net/wake.test.ts apps/server/src/rejoin.test.ts`
Expected: PASS. `rejoin.test.ts` is the server's existing proof that a dropped seat is held and resumed, which is what a forced reconnect relies on.

- [ ] **Step 6: Commit**

```bash
npx biome format --write apps/web/src/net/wake.ts apps/web/src/net/wake.test.ts apps/web/src/game/useRoom.ts apps/web/src/table/useTableSocket.ts
npm run typecheck
git add apps/web/src/net/wake.ts apps/web/src/net/wake.test.ts apps/web/src/game/useRoom.ts apps/web/src/table/useTableSocket.ts
git commit -m "feat(web): rejoin the table when a backgrounded app comes back" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Sound comes back after the app does

**Files:**
- Modify: `apps/web/src/game/audio.ts:174-190` (`unlock`)
- Test: `apps/web/src/game/audioResume.test.ts`

**Interfaces:**
- Consumes: `unlock()` from `apps/web/src/game/audio.ts`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/game/audioResume.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS suspends an AudioContext whenever the app is put away and never resumes
 * it on its own. The listeners that call `unlock` are `once`, so the table had
 * no way to get its sound back for the rest of the session.
 */

class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState | "interrupted" = "running";
  readonly destination = {};
  readonly resume = vi.fn(async () => {
    this.state = "running";
  });

  constructor() {
    FakeContext.last = this;
  }

  createGain() {
    return { gain: { value: 0 }, connect: () => {} };
  }
}

beforeAll(async () => {
  vi.stubGlobal("AudioContext", FakeContext);
  // `unlock` starts a preload; an empty manifest rather than a network it
  // cannot reach, shaped like the stub in tossCoins.test.ts.
  vi.stubGlobal(
    "fetch",
    async () =>
      ({
        ok: true,
        json: async () => ({}),
        text: async () => "{}",
        arrayBuffer: async () => new ArrayBuffer(0),
      }) as unknown as Response,
  );
  const audio = await import("./audio.js");
  audio.unlock();
});

beforeEach(() => {
  FakeContext.last?.resume.mockClear();
});

describe("after the app has been put away", () => {
  it("resumes a suspended context on the next touch anywhere", () => {
    const context = FakeContext.last as FakeContext;
    context.state = "interrupted";

    window.dispatchEvent(new Event("pointerdown"));

    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("does the same on every later return, not just the first", () => {
    const context = FakeContext.last as FakeContext;
    for (let away = 0; away < 3; away += 1) {
      context.state = "suspended";
      window.dispatchEvent(new Event("pointerdown"));
    }

    expect(context.resume).toHaveBeenCalledTimes(3);
  });

  it("leaves a context that is already playing alone", () => {
    const context = FakeContext.last as FakeContext;
    context.state = "running";

    window.dispatchEvent(new Event("pointerdown"));

    expect(context.resume).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/game/audioResume.test.ts`
Expected: FAIL — `expected "spy" to be called 1 times, but got 0 times`.

- [ ] **Step 3: Implement**

In `apps/web/src/game/audio.ts`, add above `unlock`:

```ts
/**
 * Picks the sound back up after the page has been away.
 *
 * iOS suspends the context whenever an installed app is put away — switching
 * apps, locking the phone — and never resumes it on its own, while the
 * listeners that call `unlock` are `once` and already spent. Any later touch
 * is a gesture the browser will accept, so it is the one to use.
 */
function resumeIfStopped(): void {
  if (context !== null && context.state !== "running") {
    // A closed context cannot come back; that is silence, not an error.
    context.resume().catch(() => {});
  }
}
```

Inside `unlock`, in the branch that creates the context, directly after `master.connect(context.destination);`, add:

```ts
    window.addEventListener("pointerdown", resumeIfStopped, { passive: true });
```

It is registered only where the context is created, so it happens once per page.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/game/audioResume.test.ts apps/web/src/game/audio.test.ts apps/web/src/game/tossCoins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/game/audio.ts apps/web/src/game/audioResume.test.ts
npm run typecheck
git add apps/web/src/game/audio.ts apps/web/src/game/audioResume.test.ts
git commit -m "fix(web): resume sound after the app has been put away" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Check it on real phones

No code, unless something here fails. A service worker only runs over HTTPS (or on `localhost`), and Discord's redirect URI must match, so do this on the deployed site, not a LAN address.

- [ ] **Step 1: Full suite**

Run: `npm test`, `npm run typecheck`, `npm run lint`
Expected: all clean.

- [ ] **Step 2: 375px in a desktop browser**

Run `npm run build`, start the server with `npm start -w @backroom/server` (it logs `listening on http://localhost:3001` unless `PORT` is set), and open that address in Chrome. `localhost` counts as secure, so the worker runs there. In DevTools:
- Device toolbar at 375×812: the room, `/blackjack` and `/slots` have no sideways scroll, and the Install button (visible only once Chrome offers installation) does not push the bar wider.
- Application → Manifest: no errors; the three shortcuts are listed.
- Application → Service workers: `sw.js` is activated.
- Network → Offline, then reload: the offline page shows. Back online: the page reloads itself.
- With the iPhone preset and a reload, the Install button opens the hint on a click, and "Got it" removes it for good.

- [ ] **Step 3: Android phone, Chrome, deployed site**

Tick each only if it happens:
- [ ] Install is on the bar, and installs the app to the home screen and app drawer.
- [ ] The app opens full screen with the dark status bar, and nothing sits under the system bars.
- [ ] Sign in with Discord, from inside the app, returns to the app still signed in, not to a Chrome tab.
- [ ] Sit at a blackjack table and play a hand.
- [ ] Switch to another app for over a minute, then come back. The connection dot recovers within a few seconds and the seat is still yours.
- [ ] The next tap brings the sound back.
- [ ] A long-press on the icon shows Blackjack, Slots and Greed, and each opens its page.

- [ ] **Step 4: iPhone, Safari, deployed site**

- [ ] Install on the bar opens the hint; Share → Add to Home Screen adds the chip icon.
- [ ] The app opens full screen; the navbar is below the notch, not behind it.
- [ ] **Sign in with Discord from inside the installed app, and write down exactly what happens:**
  - does sign-in open in a sheet or leave the app?
  - does it land back in the app?
  - is the navbar showing the account?

  If the app ends up signed out, or sign-in finishes in Safari instead, **stop and report it**. The fix is a separate design, per **Known risk** above.
- [ ] Put the app away for over a minute (lock the phone), come back: the table reconnects and the seat is held.
- [ ] The next tap brings the sound back.

- [ ] **Step 5: Record the result**

Put the checklist outcome in the PR description, including the iOS sign-in result whichever way it went.
