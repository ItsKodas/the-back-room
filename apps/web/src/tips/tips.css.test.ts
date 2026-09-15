import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offendingDeclarations } from "../style/narrow.js";

/*
 * The jar is the whole interface on a phone, so looking at it must never take
 * the document sideways with it — the building's one hard rule at 375px.
 *
 * jsdom has no layout engine, so nothing here can lay a page out and measure
 * whether it actually overflows (`scrollWidth` is always 0). What can be
 * checked is the stylesheet itself: a fixed `width` or `min-width` wider than
 * the narrowest screen this building promises to fit is a real overflow
 * hazard wherever it is not fenced behind a `min-width` media query that
 * keeps it off screens that narrow in the first place.
 */

const css = readFileSync(
  [
    resolve(process.cwd(), "apps/web/src/tips/tips.css"),
    resolve(process.cwd(), "src/tips/tips.css"),
  ].find((path) => existsSync(path)) as string,
  "utf8",
);

describe("the tip jar's stylesheet", () => {
  it("declares no width or min-width past 375px outside a min-width media query", () => {
    expect(offendingDeclarations(css)).toEqual([]);
  });
});
