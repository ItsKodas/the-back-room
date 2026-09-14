import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { META_CLOSE, META_OPEN } from "./meta.js";
import type { BackRoomServer } from "./server.js";
import { createBackRoomServer } from "./server.js";

/**
 * The head an unfurler actually gets, over HTTP.
 *
 * `meta.ts` is tested directly and was right the whole time; what was wrong
 * was that one address never reached it. `express.static` answers a directory
 * with its index.html, the site's front door is a directory, and so "/" was
 * served the built file straight off the disk — defaults and all — while every
 * other address went through the handler that writes the head. Nothing in a
 * unit test can see that, because the bug is which of two handlers replies.
 *
 * Served from a directory this file writes rather than from a real build, so
 * the check does not quietly depend on somebody having run `vite build`.
 */

let server: BackRoomServer;
let port: number;
let dist: string;

/** A shell shaped like the real one: defaults between the markers. */
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    ${META_OPEN}
    <title>The Back Room</title>
    <meta property="og:image" content="/og/site.png" />
    ${META_CLOSE}
  </head>
  <body><div id="root"></div></body>
</html>
`;

beforeEach(async () => {
  dist = mkdtempSync(join(tmpdir(), "backroom-dist-"));
  writeFileSync(join(dist, "index.html"), SHELL, "utf8");
  server = createBackRoomServer({
    serveClient: true,
    clientDist: dist,
    botDelayMs: 5,
    emptyRoomTtlMs: 200,
  });
  await new Promise<void>((resolve) => {
    server.http.listen(0, resolve);
  });
  port = (server.http.address() as AddressInfo).port;
});

afterEach(async () => {
  await server.close();
  rmSync(dist, { recursive: true, force: true });
});

const get = async (path: string): Promise<string> => {
  const answer = await fetch(`http://127.0.0.1:${port}${path}`);
  expect(answer.status, path).toBe(200);
  return answer.text();
};

describe("the page a link unfurls into", () => {
  it("writes the head for the front door, not just for the rooms off it", async () => {
    /*
     * The most pasted link there is, and the one that was being served raw.
     * Asserted on the injected head being *different* from the shell rather
     * than on any one tag: what went wrong was that nothing was written at
     * all, and the tags left behind were plausible.
     */
    const html = await get("/");

    expect(html).toContain('<link rel="canonical"');
    expect(html).toContain('<meta property="og:url"');
    expect(html).toContain('content="index, follow"');
  });

  it("gives it a card an unfurler can actually fetch", async () => {
    /*
     * The whole cost of the bug. index.html's default is a relative path,
     * because a file served by something simpler has no way to know its own
     * origin — and a relative og:image reaches nobody, which is exactly what
     * `meta.ts` says about the field.
     */
    const html = await get("/");
    const image = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1] ?? "";

    expect(image).toMatch(/^https?:\/\//);
    expect(image).toMatch(/\/og\/site\.png$/);
  });

  it("tells a crawler the room is free to play, in a field made for saying it", async () => {
    /*
     * The head says what the page is called; the graph says what it is. This
     * building deals blackjack, roulette and slots, which is exactly what a
     * site that takes money looks like from the outside — and the only thing
     * standing between those two readings is one boolean, on the way out, in
     * a format something other than a person can read.
     *
     * Over HTTP rather than against `jsonLd` directly, because `meta.ts` was
     * right the whole time once before and the bug was that one address never
     * reached it.
     */
    const html = await get("/roulette");
    const body = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];

    expect(body, "no graph on the page").toBeDefined();
    const graph = (JSON.parse(body ?? "") as { "@graph": Record<string, unknown>[] })["@graph"];
    const game = graph.find((one) => one["@type"] === "VideoGame");

    expect(game?.["isAccessibleForFree"]).toBe(true);
    expect(game?.["name"]).toBe("Roulette");
    expect(graph.some((one) => one["@type"] === "Organization")).toBe(true);
  });

  it("says nothing structured about an address that asked not to be indexed", async () => {
    /*
     * The two have to agree: a graph describing a lasting thing, on a page
     * whose robots tag says it will be gone next week, is a page arguing with
     * itself.
     *
     * A code with no table behind it, which is the state a crawler finds most
     * of them in — and it takes the same noindex route a live one does.
     */
    const html = await get("/6PMKG");

    expect(html).toContain('content="noindex, follow"');
    expect(html).not.toContain("ld+json");
  });

  it("still writes it for a game, which is what always worked", async () => {
    // The other half: the fix must not have moved the static mount out of the
    // way of the files it is actually there to serve.
    const html = await get("/roulette");

    expect(html).toContain("Roulette");
    expect(html).toMatch(/<meta property="og:image" content="https?:\/\/[^"]*\/og\/roulette\.png"/);
  });

  it("still serves the files beside the index", async () => {
    // `index: false` turns off one behaviour of the static mount and must not
    // have turned off the mount.
    writeFileSync(join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>", "utf8");
    const answer = await fetch(`http://127.0.0.1:${port}/favicon.svg`);

    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("<svg");
  });
});
