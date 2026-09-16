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
  // Comments stripped: a comment above a rule would read as part of its selector.
  return (found === undefined ? "" : readFileSync(found, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
}

const css = sheet("src/blackjack/blackjack.css");
const shared = sheet("src/table/table.css");

/** The declarations of the first rule for exactly this selector, at any depth. */
function ruleIn(text: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** The body of the first block opened by this at-rule prelude, braces balanced. */
function block(text: string, prelude: string): string {
  const start = text.indexOf(`${prelude} {`);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  for (let at = text.indexOf("{", start); at < text.length; at += 1) {
    if (text[at] === "{") {
      depth += 1;
    } else if (text[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(text.indexOf("{", start) + 1, at);
      }
    }
  }
  return "";
}

const desk = block(css, "@container bj (min-width: 760px)");

describe("the blackjack table on one screen", () => {
  /*
   * The page is the window, not at least the window: the table fills the fitted
   * page, and only the felt flexes inside it.
   */
  it("fills the fitted page, whose shell is exactly the window", () => {
    const shell = ruleIn(shared, ".shell:has(> .play--fit)");
    // The viewport less the notch and the home bar, which #root already pads for.
    expect(shell).toContain("height: calc(100dvh");
    expect(shell).toContain("grid-template-rows: auto minmax(0, 1fr)");
    const table = ruleIn(css, ".bj");
    expect(table).toContain("container: bj / inline-size");
    expect(table).toContain("flex: 1");
    expect(table).toContain("min-height: 0");
  });

  it("flexes only the felt on a phone", () => {
    expect(ruleIn(css, ".bj__in")).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  });

  it("puts the felt beside a side column past 760px of table, not of window", () => {
    expect(ruleIn(desk, ".bj__in")).toContain(
      'grid-template-areas: "felt read" "felt rules" "felt activity" "felt controls"',
    );
    expect(css).not.toContain("@media (max-width: 720px)");
    expect(css.split("@container bj (min-width: 760px)").length).toBe(2);
  });
});

describe("cards on the felt", () => {
  it("are sized by the felt, a size container, from both its width and its height", () => {
    const felt = ruleIn(css, ".bj__felt");
    expect(felt).toContain("container: bj-felt / size");
    expect(felt).toContain("--bj-card-dealer: clamp(34px, min(19cqi, 15cqh), 74px)");
    expect(felt).toContain("--bj-card-mine: clamp(38px, min(22cqi, 18cqh), 84px)");
    expect(felt).toContain("--bj-card-other: clamp(20px, min(9.5cqi, 8.5cqh), 38px)");
    const wide = ruleIn(desk, ".bj__felt");
    expect(wide).toContain("--bj-card-dealer: clamp(48px, min(16cqi, 15cqh), 150px)");
    expect(wide).toContain("--bj-card-mine: clamp(48px, min(15cqi, 15cqh), 132px)");
    expect(ruleIn(css, ".bj__seat--split")).toContain("--bj-card-w: clamp(26px, min(12cqi, 15cqh), 52px)");
  });

  /*
   * At a desk the felt used to stop the cards at a sliver of its width and
   * leave most of its height empty, and a full table was ten slivers in a row.
   */
  it("at a desk, gives everybody else narrower plates the more of them there are", () => {
    expect(ruleIn(desk, ".bj__others")).toContain("flex-wrap: wrap");
    expect(ruleIn(desk, ".bj__others")).toContain("--bj-plate: min(320px, max(200px, (100% - 24px) / 3))");
    expect(ruleIn(desk, ".bj__others:has(> :nth-child(3))")).toContain("--bj-plate: max(180px, (100% - 36px) / 4)");
    expect(ruleIn(desk, ".bj__others:has(> :nth-child(5))")).toContain("--bj-plate: max(148px, (100% - 48px) / 5)");
    // Each plate sizes its cards off its own width, so a narrower plate is smaller cards.
    const other = ruleIn(desk, ".bj__seat--other");
    expect(other).toContain("flex: 0 0 var(--bj-plate)");
    expect(other).toContain("container-type: inline-size");
    expect(ruleIn(desk, ".bj__seat--other > *")).toContain("--bj-card-w: clamp(26px, min(100cqi / 2.5, 13cqh), 100px)");
    // A second row is height the dealer and your own hand give up.
    const full = ruleIn(desk, ".bj__felt:has(.bj__seat--other:nth-child(6))");
    expect(full).toContain("--bj-card-dealer: clamp(48px, min(16cqi, 9cqh), 150px)");
    expect(full).toContain("--bj-card-mine: clamp(48px, min(15cqi, 9cqh), 132px)");
  });

  it("at a desk, scrolls the other players rather than the felt, so your own hand stays in view", () => {
    expect(ruleIn(desk, ".bj__seat--mine")).toContain("flex: none");
    expect(ruleIn(desk, ".bj__others")).toContain("overflow-y: auto");
    expect(ruleIn(desk, ".bj__others")).toContain("min-height: 0");
    expect(ruleIn(desk, ".bj__seats")).toContain("min-height: 0");
  });

  it("inherit their width rather than declaring one on the card itself", () => {
    /*
     * A custom property set on an element beats the one it would inherit, which
     * is how every Greed die once came out one fixed size whatever the felt had.
     */
    const onCard = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(
        ([, selectors = "", body = ""]) =>
          selectors.split(",").some((one) => /\.bj-card$/.test(one.trim())) && body.includes("--bj-card-w:"),
      )
      .map(([, selectors = ""]) => selectors.trim());
    expect(onCard).toEqual([]);
  });

  /*
   * A hand used to scroll within itself so a long one kept its total in view.
   * But a scroller counts a card still flying in from the shoe as overflow, so
   * every deal flashed a scrollbar and clipped the card on its way in. A hand
   * now fits whatever room its row gives it, overlapping deeper as it grows.
   */
  it("fits the room its row gives it, overlapping deeper as it grows, rather than scrolling", () => {
    const rule = ruleIn(css, ".bj__seat .bj-hand");
    expect(rule).not.toMatch(/overflow/);
    expect(rule).toContain("container-type: inline-size");
    expect(rule).toContain("min-width: 0");
    expect(rule).toContain("flex: 0 1 calc(var(--bj-card-w) * (1 + (var(--bj-places, 1) - 1) * var(--bj-show)))");
    expect(ruleIn(css, ".bj__seat .bj-hand .bj-card + .bj-card")).toContain(
      "margin-left: clamp(var(--bj-card-w) * -0.82, (100cqi - var(--bj-card-w)) / (var(--bj-places, 2) - 1) - var(--bj-card-w), var(--bj-card-w) * (var(--bj-show) - 1))",
    );
    expect(css).not.toMatch(/\.bj[^{}]*\{[^}]*overflow-x: (auto|scroll)/);
  });

  it("are a length by the time they reach a hand, so a hand's own container units cannot resize them", () => {
    // Otherwise a width written in the felt's cqi would be measured against the hand.
    expect(block(css, "@property --bj-card-w")).toContain('syntax: "<length>"');
  });

  it("overlap by 28% in a dealt hand and 42% in a split box when there is room, and never at the dealer's", () => {
    expect(ruleIn(css, ".bj__seat .bj-hand")).toContain("--bj-show: 0.72");
    expect(ruleIn(css, ".bj__box .bj-hand")).toContain("--bj-show: 0.58");
    /*
     * Explicit, not merely absent. Hand.tsx marks any hand of four or more
     * places `bj-hand--tight` for the seats it was built for, and the dealer
     * routinely draws to four — so the shared -26px rule reaches the dealer's
     * cards unless a dealer-scoped rule of higher specificity resets it.
     */
    expect(ruleIn(css, ".bj__dealer .bj-hand .bj-card + .bj-card")).toContain("margin-left: 0");
  });
});

describe("the rest of the table", () => {
  it("keeps every control at least a thumb tall", () => {
    expect(ruleIn(css, ".bj__controls :is(.slab, .key)")).toContain("min-height: 52px");
  });

  it("scrolls the felt inside itself, never the page", () => {
    expect(ruleIn(css, ".bj__cloth")).toContain("overflow-y: auto");
  });

  /*
   * overflow-y: auto quietly makes overflow-x auto as well, and a card dealt in
   * from the shoe starts out past the right edge — so without this, every deal
   * near the edge flashed a sideways scrollbar under the felt.
   */
  it("never scrolls the felt or the other players sideways, even while a card is on its way in", () => {
    expect(ruleIn(css, ".bj__cloth")).toContain("overflow-x: hidden");
    expect(ruleIn(desk, ".bj__others")).toContain("overflow-x: hidden");
  });

  it("leaves none of the old buttons and panels behind", () => {
    expect(css).not.toMatch(/\.(btn|panel|bots)(\b|__|--)/);
    expect(css).not.toContain("bj__actions");
  });
});

describe("motion at the blackjack table", () => {
  it("switches off every animation and transition it runs", () => {
    const reduced = block(css, "@media (prefers-reduced-motion: reduce)");
    const outside = css.replace(reduced, "");
    const moving = [...outside.matchAll(/([^{}]+)\{[^{}]*\b(?:animation|animation-name|transition):/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith("@") && !/^(from|to|\d+%)$/.test(selector));
    expect(moving.length).toBeGreaterThan(0);
    // Exact selectors, not a substring match that .bj__seat would let .bj__seat--turn satisfy.
    const off = [...reduced.matchAll(/([^{}]+)\{/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    for (const selector of moving) {
      expect(off, `${selector} has no off switch`).toContain(selector);
    }
  });

  it("has one off switch, so nothing is left out of a second", () => {
    expect(css.split("@media (prefers-reduced-motion: reduce)").length).toBe(2);
  });
});
