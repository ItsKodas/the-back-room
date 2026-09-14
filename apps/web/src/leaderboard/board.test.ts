import { describe, expect, it } from "vitest";
import { pinned, ranked, winRate } from "./board.js";
import type { Board, BoardRow } from "./board.js";

const row = (id: string, chips: number, stats: Partial<BoardRow["stats"]> = {}): BoardRow => ({
  id,
  name: id,
  avatar: null,
  accentColor: null,
  chips,
  stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0, ...stats },
});

describe("what a board says", () => {
  it("calls nobody's win rate a nothing-over-nothing", () => {
    expect(winRate({ games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 })).toBe(0);
    expect(winRate({ games: 4, wins: 1, chipsWon: 0, chipsStaked: 0 })).toBe(25);
  });

  it("gives everybody on the same figure the same rank, and skips after a tie", () => {
    const rows = [row("a", 900), row("b", 500), row("c", 500), row("d", 100)];
    expect(ranked(rows, "chips").map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
  });

  it("pins you to the bottom only when you are off the end of the page", () => {
    const rows = [row("a", 900), row("b", 500)];
    const off: Board = { sort: "chips", rows, you: { row: row("z", 1), rank: 340 }, total: 340 };
    expect(pinned(off)?.rank).toBe(340);

    const on: Board = { sort: "chips", rows, you: { row: rows[1] as BoardRow, rank: 2 }, total: 2 };
    expect(pinned(on)).toBeNull();
  });
});
