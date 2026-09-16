import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { scribbleAdapter } from "./adapter.js";
import { WORDS } from "./fixtures.js";

const deps = (): GameDeps => ({
  take: vi.fn(async () => false),
  give: vi.fn(async () => {}),
  record: vi.fn(async () => {}),
  finished: vi.fn(async () => {}),
});

function start(setup: Record<string, unknown> = {}, seated = 3) {
  let time = 5_000_000;
  const clock = {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
  const game = scribbleAdapter({ now: clock.now, random: () => 0 });
  const table = game.create("ABCDE", { forFun: true, maxSeats: 10, scribble: { custom: WORDS, onlyCustom: true, ...setup } });
  for (let at = 0; at < seated; at += 1) {
    table.join(`s${at}`, `P${at}`, null);
  }
  return { game, table, clock };
}

describe("opening a table", () => {
  it("refuses a table too small for the teams it wants", () => {
    const game = scribbleAdapter();
    expect(() => game.create("ABCDE", { maxSeats: 4, scribble: { mode: "teams", teams: 3 } })).toThrow(
      "3 teams need at least 6 seats.",
    );
  });

  it("opens everyone-for-themselves at four seats", () => {
    const game = scribbleAdapter();
    expect(game.create("ABCDE", { maxSeats: 4 }).maxSeats).toBe(4);
  });
});

describe("the table's own clock", () => {
  it("runs countdown, pick, each hint, the end of drawing, and the reveal, each under its own key", () => {
    const { game, table, clock } = start({ hints: "few", drawSeconds: 80 });

    const countdown = game.pause?.(table);
    expect(countdown).toMatchObject({ key: "countdown:0", ms: 15_000 });
    countdown?.run();

    expect(game.pause?.(table)).toMatchObject({ key: "pick:1", ms: 15_000 });
    game.act(table, "s0", { type: "pick", index: 0 }, deps());

    expect(game.pause?.(table)).toMatchObject({ key: "draw:1:0", ms: 40_000 });
    clock.advance(40_000);
    game.pause?.(table)?.run();
    expect(game.pause?.(table)).toMatchObject({ key: "draw:1:1", ms: 24_000 });
    clock.advance(24_000);
    game.pause?.(table)?.run();
    expect(game.pause?.(table)).toMatchObject({ key: "draw:1:2", ms: 16_000 });
    clock.advance(16_000);
    game.pause?.(table)?.run();

    expect(game.pause?.(table)).toMatchObject({ key: "reveal:1", ms: 5_000 });
    game.pause?.(table)?.run();
    expect(game.pause?.(table)?.key).toBe("pick:2");
  });

  it("waits on nothing while there are too few to deal", () => {
    const { game, table } = start({}, 2);
    expect(game.pause?.(table)).toBeNull();
  });
});

describe("actions", () => {
  it("relays a stroke instead of asking for a broadcast", () => {
    const { game, table } = start();
    table.deal();
    game.act(table, "s0", { type: "pick", index: 0 }, deps());
    const result = game.act(table, "s0", { type: "stroke", id: "k1", seq: 0, ink: "red", size: 1, pts: [1, 1] }, deps());
    expect(result).toEqual({ relay: { kind: "stroke", id: "k1", by: "s0", ink: "red", size: 1, seq: 0, pts: [1, 1] } });
  });

  it("relays nothing for a batch it already had, and still asks for no broadcast", () => {
    const { game, table } = start();
    table.deal();
    game.act(table, "s0", { type: "pick", index: 0 }, deps());
    const batch = { type: "stroke", id: "k1", seq: 0, ink: "red", size: 1, pts: [1, 1] };
    game.act(table, "s0", batch, deps());
    expect(game.act(table, "s0", batch, deps())).toEqual({ relay: null });
  });

  it("returns nothing for a move that changes the table, so the room broadcasts it", () => {
    const { game, table } = start();
    table.deal();
    expect(game.act(table, "s0", { type: "pick", index: 0 }, deps())).toBeUndefined();
  });

  it("refuses a stroke from a guesser, and a move it does not know", () => {
    const { game, table } = start();
    table.deal();
    game.act(table, "s0", { type: "pick", index: 0 }, deps());
    expect(() => game.act(table, "s1", { type: "stroke", id: "k", seq: 0, ink: "red", size: 1, pts: [1, 1] }, deps())).toThrow(
      TableError,
    );
    expect(() => game.act(table, "s1", { type: "bank" }, deps())).toThrow("That is not a move at this table.");
  });

  it("routes chat through the table", () => {
    const { game, table } = start();
    table.deal();
    game.act(table, "s0", { type: "pick", index: 0 }, deps());
    expect(game.chat?.(table, "s1", "lighthose")).toMatchObject({ to: ["s1"], kind: "close" });
  });
});

describe("money", () => {
  it("never touches an account", async () => {
    const { game, table } = start();
    const d = deps();
    await game.settle(table, d);
    expect(await game.void(table, d)).toEqual([]);
    expect(d.take).not.toHaveBeenCalled();
    expect(d.give).not.toHaveBeenCalled();
    expect(d.finished).not.toHaveBeenCalled();
  });

  it("is settled while the result is up, and names the winners for taunts", () => {
    const { game, table } = start({ rounds: 2 });
    table.deal();
    while (table.phase !== "over") {
      table.autoPick();
      table.deadline = table.now();
      table.advanceDrawing();
      table.endReveal();
    }
    expect(game.isSettled(table)).toBe(true);
    expect(game.winners?.(table)).toEqual(["s0", "s1", "s2"]);
  });
});
