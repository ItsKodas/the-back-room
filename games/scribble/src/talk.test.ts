import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { tableFor } from "./fixtures.js";
import { INK_REFUSALS } from "./ink.js";

/** Runs `fn`, and hands back the message it threw rather than letting it propagate. */
const messageOf = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected a throw");
};

/* Three seated, s0 drawing "lighthouse". */
function drawingSolo(seated = 3) {
  const made = tableFor({ drawSeconds: 80 }, seated);
  made.table.deal();
  made.table.pick("s0", 0);
  return made;
}

describe("chat outside a turn", () => {
  it("goes to the whole room", () => {
    const { table } = tableFor();
    expect(table.say("s1", "evening all")).toEqual({ to: "room", text: "evening all", changed: false });
  });
});

describe("a guesser's chat while somebody draws", () => {
  it("sends a wrong guess to everybody who has not got it yet", () => {
    const { table } = drawingSolo(4);
    table.guessed.set("s3", 100);
    expect(table.say("s1", "tower")).toEqual({ to: ["s0", "s1", "s2"], kind: "guess", text: "tower", changed: false });
  });

  it("turns a correct guess into 'got it' for the room, and never repeats the word", () => {
    const { table, clock } = drawingSolo(4);
    clock.advance(20_000);
    const said = table.say("s1", "LightHouse");
    expect(said).toEqual({ to: "room", kind: "got", text: "got it", changed: true });
    expect(table.guessed.get("s1")).toBe(238);
  });

  it("ends the drawing once the last guesser has it", () => {
    const { table } = drawingSolo(3);
    table.say("s1", "lighthouse");
    expect(table.phase).toBe("drawing");
    table.say("s2", "lighthouse");
    expect(table.phase).toBe("reveal");
  });

  it("tells only its author that a guess was close", () => {
    const { table } = drawingSolo();
    expect(table.say("s1", "lighthose")).toEqual({ to: ["s1"], kind: "close", text: "lighthose", changed: false });
  });

  it("keeps a message that contains the word to its author, rather than telling the room", () => {
    const { table } = drawingSolo();
    expect(table.say("s1", "is it a light house")).toMatchObject({ to: ["s1"], kind: "close" });
    expect(table.guessed.has("s1")).toBe(false);
  });

  it("lets people who have it talk among themselves and the drawers", () => {
    const { table } = drawingSolo(4);
    table.say("s1", "lighthouse");
    table.say("s2", "lighthouse");
    expect(table.say("s1", "easy one")).toEqual({ to: ["s1", "s2", "s0"], kind: "aside", text: "easy one", changed: false });
  });

  it("does not let somebody who has it guess again for more points", () => {
    const { table, clock } = drawingSolo(4);
    table.say("s1", "lighthouse");
    const first = table.guessed.get("s1");
    clock.advance(1_000);
    expect(table.say("s1", "lighthouse").kind).toBe("aside");
    expect(table.guessed.get("s1")).toBe(first);
  });

  it("goes to the room during the pick, when there is no word to give away", () => {
    const { table } = tableFor();
    table.deal();
    expect(table.say("s1", "come on").to).toBe("room");
  });
});

describe("a drawer's chat", () => {
  it("is refused for a drawer on their own", () => {
    const { table } = drawingSolo();
    expect(() => table.say("s0", "hint: tall")).toThrow("You're drawing.");
  });

  it("goes only to the pair when two draw together", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    table.pick("s0", 0);
    expect(table.say("s2", "I'll do the sea")).toEqual({ to: ["s0", "s2"], kind: "pair", text: "I'll do the sea", changed: false });
  });

  it("refuses a pair message that gives the word away, however it is spelled", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    table.pick("s0", 0);
    expect(() => table.say("s2", "LIGHT-house, obviously")).toThrow(TableError);
  });

  it("keeps the three choices as secret as the word while picking", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    expect(table.say("s2", "take the first").kind).toBe("pair");
    expect(() => table.say("s2", "not sandcastle")).toThrow(TableError);
  });
});

describe("ink", () => {
  const line = { id: "k1", seq: 0, ink: "black" as const, size: 1, pts: [10, 10, 20, 20] };

  it("is only for the people drawing, and only while drawing", () => {
    const { table } = drawingSolo();
    expect(() => table.stroke("s1", line)).toThrow("Only the people drawing can draw.");
    expect(table.stroke("s0", line)).toMatchObject({ kind: "stroke", by: "s0" });
  });

  it("throws only messages from the fixed refusal list", () => {
    const { table } = drawingSolo();
    expect(INK_REFUSALS).toContain(messageOf(() => table.stroke("s1", line)));
    table.deadline = table.now();
    table.advanceDrawing();
    expect(INK_REFUSALS).toContain(messageOf(() => table.stroke("s0", line)));
  });

  it("is refused once the turn is over", () => {
    const { table } = drawingSolo();
    table.deadline = table.now();
    table.advanceDrawing();
    expect(() => table.stroke("s0", line)).toThrow(TableError);
  });

  it("lets a drawer undo and clear", () => {
    const { table } = drawingSolo();
    table.stroke("s0", line);
    expect(table.undo("s0")).toEqual({ kind: "undo", by: "s0", id: "k1" });
    table.fill("s0", { id: "f1", ink: "red", x: 1, y: 1 });
    expect(table.clear("s0")).toEqual({ kind: "clear", ids: ["f1"] });
    expect(table.ink.marks).toEqual([]);
  });
});
