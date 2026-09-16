import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Found from the working directory rather than import.meta.url, like the other
 * stylesheet suites, so it runs from the repository root or the web package.
 */
const css = readFileSync(
  [resolve(process.cwd(), "apps/web/src/game/greed.css"), resolve(process.cwd(), "src/game/greed.css")].find(
    (path) => existsSync(path),
  ) as string,
  "utf8",
);

/** The declarations of the first top-level rule for exactly this selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

describe("what greed.css leaves to the building", () => {
  /*
   * Talk, activity, refusals and the one-screen page are every table's, so they
   * live in table/table.css. A second copy here is a second thing to keep in
   * step, and the first one to drift.
   */
  it("carries no shared table rules of its own", () => {
    expect(css).not.toMatch(/^\.(talk|talk__scrim|activity|refusal|refusal__card) \{/m);
    expect(css).not.toContain("play--greed");
    expect(css).not.toMatch(/^:is\(\.activity/m);
  });
});

describe("the dice on the felt", () => {
  /*
   * The felt sizes a die from its own width and height, through --d set on the
   * cloth. The die's own rule declared --d as well, and a custom property set on
   * an element beats the one it inherits, so every die came out at that one
   * fixed size — six in a line on a tablet and two rows on a short phone alike.
   */
  it("take their size from the felt rather than declaring one of their own", () => {
    expect(rule(".gt__cloth")).toMatch(/--d:/);
    expect(rule(".die")).not.toMatch(/--d:/);
  });
});
