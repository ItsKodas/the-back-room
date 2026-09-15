import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Found from the working directory rather than import.meta.url, like the other
 * stylesheet suites, so it runs from the repository root or the web package.
 */
const css = readFileSync(
  [resolve(process.cwd(), "apps/web/src/game/game.css"), resolve(process.cwd(), "src/game/game.css")].find(
    (path) => existsSync(path),
  ) as string,
  "utf8",
);

describe("the table lobby's layout", () => {
  /*
   * The front room and a table's lobby both wore `.lobby`. The room's rule —
   * three tracks, two of them 220px rails — came later in the sheet and won,
   * so a table's share panel was squeezed into a rail and its code cut off.
   */
  it("is its own class, not the one the front room lays out its rails with", () => {
    expect(css.match(/^\.lobby \{/gm) ?? []).toHaveLength(1);
    expect(css).toMatch(/^\.table-lobby \{/m);
  });
});
