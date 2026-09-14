import { describe, expect, it } from "vitest";
import { ODDS_LIMIT, type Face, readFaces, toss } from "./coins.js";

describe("reading two coins", () => {
  it("calls two heads heads, and two tails tails", () => {
    expect(readFaces(["head", "head"])).toBe("heads");
    expect(readFaces(["tail", "tail"])).toBe("tails");
  });

  it("calls one of each odds, whichever way round it fell", () => {
    expect(readFaces(["head", "tail"])).toBe("odds");
    expect(readFaces(["tail", "head"])).toBe("odds");
  });
});

describe("throwing them", () => {
  /* A source that hands back exactly what a test wants, in order. */
  const feed = (...values: number[]) => {
    let at = 0;
    return () => values[at++] ?? 0;
  };

  it("reads the source once per coin, low is a head", () => {
    expect(toss(feed(0.1, 0.2))).toEqual({ faces: ["head", "head"], outcome: "heads" });
    expect(toss(feed(0.9, 0.9))).toEqual({ faces: ["tail", "tail"], outcome: "tails" });
    expect(toss(feed(0.1, 0.9))).toEqual({ faces: ["head", "tail"], outcome: "odds" });
  });

  it("splits the source exactly down the middle", () => {
    // A boundary worth pinning: an off-by-one here is a coin that is not fair,
    // and nothing downstream would ever notice.
    expect(toss(feed(0.499_999, 0.5)).faces).toEqual(["head", "tail"]);
  });

  it("is fair over a long run", () => {
    let heads = 0;
    let seen = 0;
    /* A deterministic sweep rather than a random one: a fairness test that can
       fail one run in twenty is a flake, and flakes are bugs. */
    for (let step = 0; step < 10_000; step += 1) {
      const value = (step + 0.5) / 10_000;
      const faces = toss(() => value).faces;
      for (const face of faces) {
        seen += 1;
        if (face === "head") heads += 1;
      }
    }
    expect(heads).toBe(seen / 2);
  });
});

describe("how long odds may run", () => {
  it("is five", () => {
    expect(ODDS_LIMIT).toBe(5);
  });
});

/* The type is exported and used, so a rename cannot pass typecheck silently. */
const _face: Face = "head";
void _face;
