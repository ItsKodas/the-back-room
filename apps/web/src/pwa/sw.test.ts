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
