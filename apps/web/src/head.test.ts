import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The part of the page nobody looks at, and everything else reads.
 *
 * A phone deciding what to draw on a home screen, a browser deciding when to
 * paint, and a crawler deciding what this place is all read the head and
 * nothing else. None of them complains when it is wrong — an icon that is not
 * linked is simply never used, and a stylesheet that blocks the first paint
 * looks perfect on the machine that served it.
 *
 * Read from source rather than from a build: the icons themselves are pressed
 * by a build step and are not in the repository, so a test that looked for the
 * PNGs would pass here and fail on a fresh checkout. What is checked is that
 * the manifest and the script that fills it still name the same files.
 */
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const html = read("../index.html");
const manifest = JSON.parse(read("../public/site.webmanifest")) as {
  icons: { src: string; purpose: string }[];
  start_url: string;
  theme_color: string;
};
const script = read("../../../scripts/make-icons.mjs");

describe("what the head hands to a phone", () => {
  it("links the manifest and the icon iOS insists on having its own way", () => {
    // Apple has never read a manifest. Without this link it crops the favicon
    // itself and composites the transparent corners onto black.
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });

  it("asks only for icons something actually presses", () => {
    /*
     * The two halves live in different files and nothing joins them up: a
     * rename on either side leaves a manifest pointing at a 404, and the only
     * symptom is a home screen icon quietly falling back to a screenshot.
     */
    for (const icon of manifest.icons) {
      expect(script, icon.src).toContain(icon.src.replace(/^\//, ""));
    }
    expect(script).toContain("apple-touch-icon.png");
  });

  it("offers a maskable icon, so Android does not draw its own tile behind it", () => {
    // Without one, Android shrinks the icon and puts it on a white square —
    // which is the whole mark, on the wrong colour, at the wrong size.
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("opens at the front door in the room's own colour", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#0d1015");
    expect(html).toContain('content="#0d1015"');
  });
});

describe("what the head does to the first paint", () => {
  it("does not hold the room dark waiting on somebody else's server", () => {
    /*
     * A stylesheet in the head blocks the first paint until it arrives, and
     * this one comes from fonts.googleapis.com — so on a slow connection the
     * page stayed blank for exactly as long as a third party took to answer,
     * which is the one delay a player cannot do anything about. `media="print"`
     * makes it irrelevant to the screen until it has loaded; the onload puts it
     * back.
     */
    // The noscript twin below is meant to block, so it is not one of these.
    const onScreen = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
    const fonts = [...onScreen.matchAll(/<link\b[^>]*>/g)]
      .map((found) => found[0])
      .filter((link) => link.includes("fonts.googleapis.com") && link.includes('rel="stylesheet"'));

    expect(fonts.length).toBeGreaterThan(0);
    for (const link of fonts) {
      expect(link, link).toMatch(/media="print"/);
      expect(link, link).toMatch(/onload="this\.media='all'"/);
    }
  });

  it("still loads them for a reader that runs no script", () => {
    // The onload never fires without JavaScript, so the non-blocking copy would
    // stay print-only forever. The noscript twin is what makes that safe.
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? "";

    expect(noscript).toContain("fonts.googleapis.com");
    expect(noscript).not.toContain("media=\"print\"");
  });

  it("warms the connection before it asks for anything", () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
  });
});
