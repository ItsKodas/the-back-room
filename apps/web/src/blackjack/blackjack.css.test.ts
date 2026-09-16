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
    expect(shell).toContain("height: 100dvh");
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
    expect(wide).toContain("--bj-card-dealer: clamp(40px, min(12cqi, 20cqh), 124px)");
    expect(wide).toContain("--bj-card-mine: clamp(40px, min(9.5cqi, 17cqh), 100px)");
    expect(wide).toContain("--bj-card-other: clamp(24px, min(6.2cqi, 12cqh), 70px)");
    expect(ruleIn(css, ".bj__seat--split")).toContain("--bj-card-w: clamp(26px, min(12cqi, 15cqh), 52px)");
    expect(ruleIn(desk, ".bj__seats")).toContain("grid-template-columns: minmax(0, 1.5fr)");
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

  it("overlap by 28% in a dealt hand and 42% in a split box, and not at all at the dealer's", () => {
    expect(ruleIn(css, ".bj__seat .bj-hand .bj-card + .bj-card")).toContain(
      "margin-left: calc(var(--bj-card-w) * -0.28)",
    );
    expect(ruleIn(css, ".bj__box .bj-hand .bj-card + .bj-card")).toContain(
      "margin-left: calc(var(--bj-card-w) * -0.42)",
    );
    expect(css).not.toMatch(/\.bj__dealer[^{]*\.bj-card \+ \.bj-card/);
  });
});

describe("the rest of the table", () => {
  it("keeps every control at least a thumb tall", () => {
    expect(ruleIn(css, ".bj__controls :is(.slab, .key)")).toContain("min-height: 52px");
  });

  it("scrolls the felt inside itself, never the page", () => {
    expect(ruleIn(css, ".bj__cloth")).toContain("overflow-y: auto");
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
