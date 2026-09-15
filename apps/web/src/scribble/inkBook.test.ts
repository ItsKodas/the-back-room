import type { Mark } from "@backroom/game-scribble";
import { describe, expect, it } from "vitest";
import { InkBook, toGrid } from "./inkBook.js";

const book = () => {
  let next = 0;
  return new InkBook("me", () => `id${next++}`);
};

describe("your own ink", () => {
  it("is on the napkin the moment you draw it, before anything is sent", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.extend(20, 20);
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [10, 10, 20, 20] }]);
  });

  it("goes out in batches of at most 64 points, numbered, and never twice", () => {
    const ink = book();
    ink.begin("red", 1, 0, 0);
    for (let x = 1; x < 100; x += 1) {
      ink.extend(x, 0);
    }
    const first = ink.takeBatches();
    expect(first.map((batch) => [batch.seq, batch.pts.length / 2])).toEqual([
      [0, 64],
      [1, 36],
    ]);
    expect(ink.takeBatches()).toEqual([]);
    ink.extend(200, 0);
    expect(ink.takeBatches()).toEqual([{ type: "stroke", id: "id0", seq: 2, ink: "red", size: 1, pts: [200, 0] }]);
  });

  it("ignores a pointer that has not moved, so a held finger sends nothing", () => {
    const ink = book();
    ink.begin("red", 1, 5, 5);
    ink.extend(5, 5);
    expect(ink.takeBatches()[0]?.pts).toEqual([5, 5]);
  });

  it("stays through a state that does not have it yet, and gives way once one has all of it", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.extend(20, 20);
    ink.end();
    ink.takeBatches();
    ink.sync([], true);
    expect(ink.marks()).toHaveLength(1);
    ink.sync([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [10, 10, 20, 20] }], true);
    expect(ink.marks()).toHaveLength(1);
    ink.sync([], true);
    expect(ink.marks()).toEqual([]);
  });

  it("is given up when the table refuses it", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.refused();
    expect(ink.marks()).toEqual([]);
  });

  it("is given up when the turn ends", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.sync([], false);
    expect(ink.marks()).toEqual([]);
  });

  it("shows a fill at once, and hands back the action to send", () => {
    const ink = book();
    expect(ink.fill("blue", 5, 6)).toEqual({ type: "fill", id: "id0", ink: "blue", x: 5, y: 6 });
    expect(ink.marks()).toEqual([{ kind: "fill", id: "id0", by: "me", ink: "blue", x: 5, y: 6 }]);
  });

  it("undoes a line nobody has seen without telling the server, which would undo the one before it", () => {
    const ink = book();
    ink.sync([{ kind: "stroke", id: "old", by: "me", ink: "red", size: 1, pts: [1, 1] }], true);
    ink.begin("red", 1, 10, 10);
    expect(ink.undo()).toBe(false);
    expect(ink.marks().map((mark) => mark.id)).toEqual(["old"]);
    expect(ink.undo()).toBe(true);
    expect(ink.marks()).toEqual([]);
  });
});

describe("a partner's ink", () => {
  const theirs: Mark = { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, pts: [1, 1] };

  it("is drawn as each batch lands, and a repeated batch is ignored", () => {
    const ink = book();
    const before = ink.version;
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 0, pts: [1, 1] });
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 1, pts: [2, 2] });
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 1, pts: [2, 2] });
    expect(ink.marks()).toEqual([{ ...theirs, pts: [1, 1, 2, 2] }]);
    expect(ink.version).toBeGreaterThan(before);
  });

  it("carries on a line the last state already had part of, without changing that state", () => {
    const ink = book();
    const state: Mark[] = [{ ...theirs, pts: [1, 1] }];
    ink.sync(state, false);
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 3, pts: [9, 9] });
    expect((ink.marks()[0] as { pts: number[] }).pts).toEqual([1, 1, 9, 9]);
    expect((state[0] as { pts: number[] }).pts).toEqual([1, 1]);
  });

  it("undoes and clears", () => {
    const ink = book();
    ink.sync([theirs, { kind: "fill", id: "f", by: "sam", ink: "red", x: 1, y: 1 }], true);
    ink.applyRelay("sam", { kind: "undo", by: "sam", id: "f" });
    expect(ink.marks()).toEqual([theirs]);
    ink.begin("red", 1, 3, 3);
    ink.applyRelay("sam", { kind: "clear" });
    expect(ink.marks()).toEqual([]);
  });

  it("ignores anything relayed as coming from you", () => {
    const ink = book();
    ink.applyRelay("me", { kind: "clear" });
    ink.begin("red", 1, 3, 3);
    ink.applyRelay("me", { kind: "clear" });
    expect(ink.marks()).toHaveLength(1);
  });
});

describe("pointer to grid", () => {
  it("scales to the 1000 × 750 grid, rounds, and clamps", () => {
    const rect = { left: 10, top: 20, width: 500, height: 375 };
    expect(toGrid(260, 207.5, rect)).toEqual([500, 375]);
    expect(toGrid(-50, 9999, rect)).toEqual([0, 750]);
  });
});
