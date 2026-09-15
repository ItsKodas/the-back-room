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

describe("the building around a page", () => {
  /*
   * The shell's one column was sized to its widest child. A bar with one key
   * too many for a phone was 433px of content in a 375px window, the column
   * grew to fit it, and the table under it was pushed off the side of the
   * screen along with it. A track that cannot outgrow the window makes the
   * bar's own contents give way instead.
   */
  it("keeps its column to the window, whatever is wider inside it", () => {
    const shell = css.match(/^\.shell \{([^}]*)\}/m)?.[1] ?? "";
    expect(shell).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});
