import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sheet = readFileSync(join(import.meta.dirname, "liarsdice.css"), "utf8");

/** The body of one rule, by its selector. */
const bodyOf = (selector: string): string => {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return sheet.slice(at, sheet.indexOf("}", at));
};

describe("one screen", () => {
  it("makes only the play area flex", () => {
    // Every row auto except the play area, which takes what is left.
    expect(bodyOf(".ld__in")).toContain("minmax(0, 1fr)");
  });

  it("makes the play area a size container, so pieces read off it", () => {
    const play = bodyOf(".ld__play");
    expect(play).toContain("container");
    expect(play).toContain("/ size");
    expect(play).toContain("min-height: 0");
  });

  it("sizes a die from both the width and the height it has", () => {
    const play = bodyOf(".ld__play");
    expect(play).toMatch(/--ld-die:\s*clamp\([^)]*min\([^)]*cqi[^)]*cqh/);
  });

  it("never lets a die declare its own size", () => {
    // A piece that sets the same property on itself beats the one it inherits,
    // which is how every Greed die was once a fixed 56px.
    const die = bodyOf(".ld-die");
    expect(die).not.toContain("--ld-die:");
    expect(die).toContain("var(--ld-die)");
  });

  it("sizes its own padding and pips off --ld-die rather than a bare percentage", () => {
    /*
     * Percentage padding resolves against the CONTAINING BLOCK's inline size,
     * not the die's own — so `.ld-die { padding: 12% }` sized itself off
     * `.ld__hand`'s width rather than the die's, and every pip collapsed to
     * zero the moment that row was wider than the die. Greed's `.die` sheet
     * solved exactly this with `calc(var(--d) * ratio)`, which is immune to
     * the parent's size because it never asks the containing block anything.
     */
    const die = bodyOf(".ld-die");
    expect(die).toMatch(/padding:\s*calc\([^)]*var\(--ld-die\)/);
    expect(die).not.toMatch(/padding:\s*\d+%/);

    const pip = bodyOf(".ld-die__pip");
    expect(pip).toMatch(/width:\s*calc\([^)]*var\(--ld-die\)/);
    expect(pip).toMatch(/height:\s*calc\([^)]*var\(--ld-die\)/);
    expect(pip).not.toMatch(/width:\s*\d+%/);
    expect(pip).not.toMatch(/height:\s*\d+%/);
  });

  it("makes .ld the container a table's own width is read from", () => {
    // A container cannot ask a container query about itself, so the container
    // has to sit on .ld and .ld__in stays a plain grid inside it — otherwise
    // the desk layout below never applies at any width.
    expect(bodyOf(".ld")).toContain("container: ld / inline-size");
    expect(bodyOf(".ld__in")).not.toContain("container:");
  });

  it("gives the felt its own, differently named, size container", () => {
    // Two nested containers sharing one name would make the inner one win for
    // its own descendants, which is not what the desk breakpoint means.
    const play = bodyOf(".ld__play");
    expect(play).toContain("container: ld-felt / size");
  });

  it("nothing is wider than the window", () => {
    /*
     * A table can be wide enough to trigger @container ld (min-width: 760px)
     * without the WINDOW ever being that wide — the query answers for the
     * table's own measured width, never the viewport's, and a narrow column
     * on a wide screen never crosses it. A fixed @media breakpoint, or a
     * literal width, would be the actual violation, so container-query
     * preludes are read past rather than flagged.
     */
    const withoutContainerPreludes = sheet.replace(/@container[^{]*\{/g, "@container {");
    expect(withoutContainerPreludes).not.toMatch(/min-width:\s*\d{3,}px/);
  });
});

describe("the rail of ten", () => {
  it("wraps rather than scrolling sideways", () => {
    const rail = bodyOf(".ld__rail");
    expect(rail).toContain("flex-wrap: wrap");
  });

  it("hides the names not worth their width on a phone, and says them at a desk", () => {
    // Present in the markup either way: a screen reader reads every seat.
    expect(sheet).toContain(".ld__name--quiet");
    expect(sheet).toMatch(/@container[^{]*\(min-width:\s*760px\)/);
  });

  it("says a seat's state to a screen reader on a phone and shows it at a desk", () => {
    const state = bodyOf(".ld__state");
    expect(state).toContain("clip-path");
  });

  it("keeps the spoken dice count off the screen", () => {
    // .ld__count shares its rule with .ld__state, so it has no rule of its
    // own for indexOf(".ld__count {") to find — read the declarations off
    // the comma-joined selector list instead.
    const at = sheet.indexOf(".ld__count,");
    expect(at, "no rule for .ld__count").toBeGreaterThan(-1);
    expect(sheet.slice(at, sheet.indexOf("}", at))).toContain("clip-path");
  });
});

describe("two arrangements, one markup", () => {
  it("rearranges on the table's own width, not the window's", () => {
    expect(sheet).toMatch(/@container\s+ld\b/);
    expect(sheet).not.toMatch(/@media[^{]*min-width:\s*760px/);
  });
});

describe("the controls", () => {
  it("gives every key a thumb to hit it with", () => {
    expect(bodyOf(".ld__keys")).toMatch(/min-height:\s*5[2-9]px|min-height:\s*[6-9]\dpx/);
  });

  it("puts the lit slab last, on the right", () => {
    expect(bodyOf(".ld__go")).toContain("margin-inline-start: auto");
  });

  it("names the keys themselves, not just the row, so the fitting's own 48px floor can never win the tie", () => {
    /*
     * `.ld__keys > *` and the fittings' `.key`/`.slab` rules are both one
     * selector deep — a tie a browser breaks by sheet order, and this sheet
     * loses that tie to fittings.css. Naming the actual classes gives this
     * rule two selectors' worth of specificity, which wins outright and stops
     * K1 depending on which sheet a bundler happens to emit second.
     */
    const body = bodyOf(".ld__keys > .key, .ld__keys > .slab, .ld__keys .taunt-picker__open");
    expect(body).toMatch(/min-height:\s*5[2-9]px|min-height:\s*[6-9]\dpx/);
  });
});

describe("motion has an off switch", () => {
  const names = [...sheet.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
  const reducedMarker = "@media (prefers-reduced-motion: reduce)";
  const reducedAt = sheet.indexOf(reducedMarker);

  /*
   * @keyframes bodies are stripped brace-balanced first, so a keyframe's own
   * `from`/`to`/percentage selectors are never mistaken for a rule that runs
   * it, and so a stray leftover brace can never desync the rest of the scan.
   */
  function stripBalanced(text: string, start: RegExp): string {
    let out = "";
    let cursor = 0;
    const re = new RegExp(start, "g");
    let match = re.exec(text);
    while (match !== null) {
      out += text.slice(cursor, match.index);
      const braceStart = text.indexOf("{", match.index);
      let depth = 0;
      let at = braceStart;
      for (; at < text.length; at += 1) {
        if (text[at] === "{") depth += 1;
        else if (text[at] === "}") {
          depth -= 1;
          if (depth === 0) {
            at += 1;
            break;
          }
        }
      }
      cursor = at;
      re.lastIndex = cursor;
      match = re.exec(text);
    }
    return out + text.slice(cursor);
  }

  // Comments stripped, or a heading comment right above a rule (there is one
  // above nearly every section in this sheet) would be read as part of its
  // selector, and no real selector text would ever match it back.
  const withoutComments = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutKeyframes = stripBalanced(withoutComments, /@keyframes\s+[\w-]+\s*/g);
  const reducedIndex = withoutKeyframes.indexOf(reducedMarker);
  const beforeReduced = reducedIndex === -1 ? withoutKeyframes : withoutKeyframes.slice(0, reducedIndex);
  const reducedBlock = reducedIndex === -1 ? "" : withoutKeyframes.slice(reducedIndex);

  it("declares at least one keyframe", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("has exactly one reduced-motion block", () => {
    expect(reducedAt).toBeGreaterThan(-1);
    expect(sheet.split(reducedMarker).length).toBe(2);
  });

  for (const name of names) {
    it(`turns off every selector that runs ${name}`, () => {
      /*
       * Every rule outside the off-switch block whose declarations mention
       * this keyframe by name — a real check per keyframe, unlike asserting
       * the same literal string ("animation: none") on every pass, which
       * cannot fail for any one of them.
       */
      const users = [...beforeReduced.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body = ""]) => new RegExp(`\\banimation(-name)?:\\s*[^;]*\\b${name}\\b`).test(body))
        .flatMap(([, selectors = ""]) => selectors.split(","))
        .map((selector) => selector.trim())
        .filter((selector) => selector.length > 0);
      expect(users.length, `no rule outside the off switch runs ${name}`).toBeGreaterThan(0);
      const covered = users.some((selector) => reducedBlock.includes(selector));
      expect(covered, `${name} has no selector named in the reduced-motion block (users: ${users.join(", ")})`).toBe(
        true,
      );
    });
  }

  for (const selector of [".ld-die", ".ld__clock", ".ld__reveal"]) {
    it(`names ${selector} in the off switches`, () => {
      expect(reducedBlock).toContain(selector);
    });
  }
});

describe("scrolling boxes wear the room's bar", () => {
  it("styles the webkit bar and guards the standard properties", () => {
    expect(sheet).toContain("::-webkit-scrollbar");
    expect(sheet).toContain("@supports not selector(::-webkit-scrollbar)");
  });
});
