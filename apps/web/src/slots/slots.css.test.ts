import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Found from the working directory rather than import.meta.url, like the other
 * stylesheet suites, so it runs from the repository root or the web package.
 */
function sheet(path: string): string {
  const found = [resolve(process.cwd(), `apps/web/${path}`), resolve(process.cwd(), path)].find((each) =>
    existsSync(each),
  );
  return found === undefined ? "" : readFileSync(found, "utf8");
}

/*
 * Comments stripped: a comment above a rule would otherwise read as part of its
 * selector, and a comment naming a property would read as a declaration.
 */
const css = sheet("src/slots/slots.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule for exactly this selector, at any depth. */
function rule(selector: string, within = css): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return within.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** The body of the first block opened by this at-rule prelude, braces balanced. */
function block(prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at += 1) {
    if (css[at] === "{") {
      depth += 1;
    } else if (css[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(css.indexOf("{", start) + 1, at);
      }
    }
  }
  return "";
}

const phone = block("@media (max-width: 900px)");

describe("the machine before the room", () => {
  /*
   * The wall follows the cabinet in the document, so a phone — which stacks in
   * document order — meets the machine first. Letting the grid place them in
   * source order put a column of other people's spins above the machine and
   * split the two feeds either side of it; the middle column is pinned instead,
   * so the desktop layout no longer depends on which comes first.
   */
  it("pins the cabinet to the middle column rather than taking it in turn", () => {
    const cabinet = rule(".slots__cabinet");
    expect(cabinet).toContain("grid-column: 2");
    expect(cabinet).toContain("grid-row: 1");
  });

  it("pins each feed to its own side, on the cabinet's row", () => {
    expect(rule(".feed--left")).toContain("grid-column: 1");
    expect(rule(".feed--left")).toContain("grid-row: 1");
    expect(rule(".feed--right")).toContain("grid-column: 3");
    expect(rule(".feed--right")).toContain("grid-row: 1");
  });

  /*
   * The wrapper the two feeds share is not a box on a desk: `display: contents`
   * drops them straight back into the floor's grid, so wrapping them cost the
   * wide layout nothing.
   */
  it("lets the wall vanish into the grid on a desk", () => {
    expect(rule(".wall")).toContain("display: contents");
  });

  it("keeps the tabs out of the way of a layout that has room for both", () => {
    expect(rule(".wall__tabs")).toContain("display: none");
  });
});

describe("the wall on a phone", () => {
  it("becomes a panel of its own under the machine", () => {
    expect(rule(".wall", phone)).toContain("display: block");
  });

  it("shows the tabs, one each across the panel", () => {
    const tabs = rule(".wall__tabs", phone);
    expect(tabs).toContain("display: grid");
    expect(tabs).toContain("grid-template-columns: 1fr 1fr");
  });

  it("shows only the side being asked for", () => {
    expect(phone).toMatch(/\.wall\[data-showing="all"\] \.feed--right[\s\S]{0,80}display: none/);
    expect(phone).toMatch(/\.wall\[data-showing="wins"\] \.feed--left[\s\S]{0,80}display: none/);
  });

  /*
   * A busy machine must not grow the page. Eight spins is 320px of other
   * people's evening, and on a phone that is the machine pushed off the screen.
   */
  it("caps the list and scrolls it inside its own box", () => {
    const list = rule(".feed__list", phone);
    expect(list).toContain("max-height");
    expect(list).toContain("overflow-y: auto");
  });

  /*
   * The tab already says which side this is. Printing the label again inside
   * the panel is the same four words twice, in a place with none to spare.
   */
  it("drops the label the tab is already saying", () => {
    expect(rule(".wall .feed__label", phone)).toContain("display: none");
  });
});

describe("the cabinet on a phone", () => {
  /*
   * The reels and the lever were 537px apart, so there was no scroll position
   * on any phone that showed a player both what they were playing and the thing
   * that plays it. Every one of these is a few pixels off that distance.
   */
  it("takes the padding in around the marquee, the glass and the belly", () => {
    expect(rule(".cab__marquee", phone)).toContain("padding");
    expect(rule(".cab__glass", phone)).toContain("padding");
    expect(rule(".cab__belly", phone)).toContain("padding");
    expect(rule(".screen", phone)).toContain("padding");
  });

  /*
   * Twenty-two pixels a side is six the reels could have had. The inset is
   * still there — it has to be, for the volume popover hung past the navbar
   * button — just no wider than the rest of the building's.
   */
  it("gives the reels back the wider of the two side gutters", () => {
    expect(rule(".slots", phone)).toContain("padding: var(--gr-space-4)");
  });

  it("closes the gaps between the controls", () => {
    expect(rule(".slots__controls", phone)).toContain("gap");
    expect(rule(".bet", phone)).toContain("gap");
  });

  it("sits the purse closer under the button it captions", () => {
    expect(rule(".slots__purse", phone)).toContain("margin");
  });

  /*
   * Everything above is spacing. This one is placement: the floor pins the
   * cabinet and both feeds to row 1 so a wide screen can put them side by side,
   * and a single-column grid that inherited those would stack all three into
   * the same cell — the wall drawn straight over the machine.
   */
  it("lets the wall fall below the machine rather than into it", () => {
    const cabinet = rule(".slots__cabinet", phone);
    expect(cabinet).toContain("grid-column: 1");
    expect(cabinet).toContain("grid-row: auto");
  });

  /* The only thing you press during a hand that was under a thumb's width. */
  it("gives the line plates a thumb to be hit with", () => {
    expect(rule(".picker__pick", phone)).toContain("min-height: 44px");
  });
});

describe("the off switch", () => {
  it("stills the tab underline for anybody who asked for less motion", () => {
    expect(block("@media (prefers-reduced-motion: reduce)")).toContain(".wall__tabs::after");
  });
});
