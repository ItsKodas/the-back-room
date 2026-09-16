import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FETCH_BLOCKED_PORTS, listenForFetch } from "./test-listen.js";

let http: Server | null = null;

afterEach(async () => {
  if (http?.listening) {
    await new Promise((resolve) => http?.close(resolve));
  }
  http = null;
});

/** A blocked port nothing else on this machine is using, or null if none is. */
async function freeBlockedPort(): Promise<number | null> {
  for (const port of [6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]) {
    const probe = createServer();
    const free = await new Promise<boolean>((resolve) => {
      probe.once("error", () => resolve(false));
      probe.listen(port, () => resolve(true));
    });
    if (free) {
      await new Promise((resolve) => probe.close(resolve));
      return port;
    }
  }
  return null;
}

describe("listenForFetch", () => {
  // The flake this guards against: a full suite run on a machine whose dynamic
  // port range starts at 1024 failed once with `fetch failed … bad port`,
  // because listen(0) had landed on a port the Fetch standard blocks.
  it("never settles on a port fetch refuses, even when handed one", async () => {
    const blocked = await freeBlockedPort();
    expect(blocked, "every blocked port is in use on this machine").not.toBeNull();

    http = createServer((_request, response) => response.end("reached"));
    const port = await listenForFetch(http, blocked ?? 0);

    const answer = await fetch(`http://127.0.0.1:${port}/`);
    expect(await answer.text()).toBe("reached");
    expect(FETCH_BLOCKED_PORTS.has(port)).toBe(false);
  });

  // The helper only helps the servers that use it. failures.test.ts kept its
  // own listen(0) and flaked once in a full suite: the jar acked over the
  // socket, which does not use fetch, and then its health check hit a blocked
  // port and reported `fetch failed`. So every server test goes through here.
  it("is how every server test listens", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const bare = readdirSync(here)
      .filter((name) => /\.test\.tsx?$/.test(name) && name !== "test-listen.test.ts")
      .filter((name) => /\.listen\(\s*0\s*[,)]/.test(readFileSync(join(here, name), "utf8")));
    expect(bare).toEqual([]);
  });

  // The list is copied from the standard, so check it against the fetch that
  // actually runs: a port listed here that fetch would allow is harmless, but
  // a sample that fetch no longer blocks means the copy has drifted.
  it("lists ports this Node's fetch really does refuse", async () => {
    for (const port of [1719, 2049, 5060, 6000, 6669, 10080]) {
      expect(FETCH_BLOCKED_PORTS.has(port)).toBe(true);
      const failure = await fetch(`http://127.0.0.1:${port}/`).catch((error: Error) => error);
      expect((failure as Error & { cause?: Error }).cause?.message, `port ${port}`).toBe("bad port");
    }
  });
});
