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

  it("tells the server when undoing a line it has already gotten a batch of", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.extend(20, 20);
    ink.end();
    ink.takeBatches();
    expect(ink.undo()).toBe(true);
  });

  it("shows the fuller local copy's own points, not just its length, while a state only partly has the line", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.extend(20, 20);
    ink.extend(30, 30);
    ink.sync([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [10, 10, 20, 20] }], true);
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [10, 10, 20, 20, 30, 30] }]);
  });
});

describe("what a refusal can give up", () => {
  // A refusal names no line, so this attributes it to the oldest ink action
  // still waiting on an ack: exactly the one the server's ordering guarantees
  // it was about. takeBatches()/fill()/a told undo/a clear each queue what
  // they send; acked() is what the done callback on a successful send calls,
  // moving the queue on so the next refusal blames whatever comes next.
  it("removes a line flushed whole by end(), and a following undo sends nothing for it", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.extend(20, 20);
    ink.end();
    ink.takeBatches();
    ink.refused();
    expect(ink.marks()).toEqual([]);
    expect(ink.undo()).toBe(false);
  });

  it("truncates a refused batch, leaving only the batches before it", () => {
    const ink = book();
    ink.begin("red", 1, 0, 0);
    for (let x = 1; x < 100; x += 1) {
      ink.extend(x, 0);
    }
    ink.takeBatches(); // batch 0 (64 points), batch 1 (36 points)
    ink.acked(); // batch 0 accepted
    ink.refused(); // batch 1 refused
    expect(ink.marks()).toEqual([
      { kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: Array.from({ length: 64 }, (_, i) => [i, 0]).flat() },
    ]);
  });

  // The finger can stay down through a slow round trip (assume it does — see
  // CLAUDE.md), so a second batch of the same line is routinely still
  // outstanding when the first's refusal lands. Rolling back by how many
  // points a batch held, counted from wherever the line currently ends, undoes
  // whatever was typed after it instead of the batch itself; only the
  // position the refused batch started at survives that.
  it("rolls a refused batch back to where it started, not by how many points it held", () => {
    const ink = book();
    ink.begin("red", 1, 0, 0);
    ink.extend(1, 0);
    ink.takeBatches(); // batch A: the whole line so far, starting at position 0
    ink.extend(2, 0);
    ink.takeBatches(); // batch B: one more point, still in flight, finger still down
    ink.refused(); // blames A: nothing preceded it, so the line empties
    expect(ink.marks()).toEqual([]);
  });

  it("rolls back to where a batch started even with a later one also outstanding, and never grows pts back", () => {
    const ink = book();
    ink.begin("red", 1, 0, 0);
    ink.extend(1, 0);
    ink.takeBatches(); // batch 0: position 0, the pair (0,0)-(1,0)
    ink.acked(); // batch 0 accepted
    ink.extend(2, 0);
    ink.takeBatches(); // batch 1: position 4
    ink.extend(3, 0);
    ink.takeBatches(); // batch 2: position 6, still in flight, finger still down
    ink.refused(); // blames batch 1: rolls back to position 4, keeping only batch 0's pair
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [0, 0, 1, 0] }]);
    ink.acked(); // batch 1's own guaranteed ack moves the queue to batch 2
    ink.refused(); // blames batch 2: position 6 is stale now that pts is only 4 long
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [0, 0, 1, 0] }]);
  });

  it("removes a refused fill", () => {
    const ink = book();
    ink.fill("blue", 5, 6);
    ink.refused();
    expect(ink.marks()).toEqual([]);
  });

  it("falls back to the open line's unsent tail when nothing is outstanding", () => {
    const ink = book();
    ink.begin("red", 1, 10, 10);
    ink.extend(20, 20);
    // Never taken, so nothing was ever sent — the queue is empty.
    ink.refused();
    expect(ink.marks()).toEqual([]);
  });

  it("changes nothing when there is no outstanding action and no open line", () => {
    const ink = book();
    ink.sync([{ kind: "stroke", id: "old", by: "me", ink: "red", size: 1, pts: [1, 1] }], true);
    ink.refused();
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "old", by: "me", ink: "red", size: 1, pts: [1, 1] }]);
  });

  it("does nothing locally for an undo that gets refused, leaving the next state to rule on it", () => {
    const ink = book();
    ink.sync([{ kind: "stroke", id: "old", by: "me", ink: "red", size: 1, pts: [1, 1] }], true);
    ink.begin("red", 1, 5, 5);
    ink.end();
    ink.takeBatches();
    ink.acked();
    expect(ink.undo()).toBe(true);
    ink.refused();
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "old", by: "me", ink: "red", size: 1, pts: [1, 1] }]);
  });

  it("does nothing locally for a clear that gets refused, leaving the next state to rule on it", () => {
    const ink = book();
    ink.sync([{ kind: "stroke", id: "old", by: "me", ink: "red", size: 1, pts: [1, 1] }], true);
    ink.clear();
    ink.refused();
    expect(ink.marks()).toEqual([]);
  });

  it("matches the server's picture once a state confirms what a refusal truncated", () => {
    const ink = book();
    ink.begin("red", 1, 0, 0);
    for (let x = 1; x < 100; x += 1) {
      ink.extend(x, 0);
    }
    ink.takeBatches();
    ink.acked();
    ink.refused();
    const serverPts = Array.from({ length: 64 }, (_, i) => [i, 0]).flat();
    ink.sync([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: serverPts }], true);
    expect(ink.marks()).toEqual([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: serverPts }]);
  });
});

describe("a partner's ink", () => {
  const theirs: Mark = { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, pts: [1, 1] };

  it("is drawn as each batch lands, and a repeated batch is ignored", () => {
    const ink = book();
    const v0 = ink.version;
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 0, pts: [1, 1] });
    const v1 = ink.version;
    expect(v1).toBe(v0 + 1);
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 1, pts: [2, 2] });
    const v2 = ink.version;
    expect(v2).toBe(v1 + 1);
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 1, pts: [2, 2] });
    expect(ink.version).toBe(v2);
    expect(ink.marks()).toEqual([{ ...theirs, pts: [1, 1, 2, 2] }]);
  });

  it("carries on a line the last state already had part of, without changing that state", () => {
    const ink = book();
    const state: Mark[] = [{ ...theirs, pts: [1, 1] }];
    ink.sync(state, false);
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "blue", size: 2, seq: 3, pts: [9, 9] });
    expect((ink.marks()[0] as { pts: number[] }).pts).toEqual([1, 1, 9, 9]);
    expect((state[0] as { pts: number[] }).pts).toEqual([1, 1]);
  });

  it("undoes a named line", () => {
    const ink = book();
    ink.sync([theirs, { kind: "fill", id: "f", by: "sam", ink: "red", x: 1, y: 1 }], true);
    ink.applyRelay("sam", { kind: "undo", by: "sam", id: "f" });
    expect(ink.marks()).toEqual([theirs]);
  });

  it("ignores anything relayed as coming from you", () => {
    const ink = book();
    ink.applyRelay("me", { kind: "clear", ids: [] });
    ink.begin("red", 1, 3, 3);
    ink.applyRelay("me", { kind: "clear", ids: [] });
    expect(ink.marks()).toHaveLength(1);
  });

  describe("a clear that names what it took", () => {
    it("removes exactly the ids it names", () => {
      const ink = book();
      ink.sync([theirs], true);
      ink.applyRelay("sam", { kind: "clear", ids: ["p1"] });
      expect(ink.marks()).toEqual([]);
    });

    it("leaves a pending line the clear did not name", () => {
      const ink = book();
      ink.sync([theirs], true);
      ink.begin("red", 1, 3, 3);
      ink.applyRelay("sam", { kind: "clear", ids: ["p1"] });
      expect(ink.marks().map((mark) => mark.id)).toEqual(["id0"]);
    });

    it("keeps an open stroke drawing when the clear does not name it", () => {
      const ink = book();
      ink.begin("red", 1, 3, 3);
      ink.applyRelay("sam", { kind: "clear", ids: [] });
      ink.extend(10, 10);
      expect((ink.marks()[0] as { pts: number[] }).pts).toEqual([3, 3, 10, 10]);
    });

    it("keeps a fully-sent pending line the clear did not name", () => {
      const ink = book();
      ink.begin("red", 1, 1, 1);
      ink.extend(2, 2);
      ink.end();
      ink.takeBatches();
      ink.applyRelay("sam", { kind: "clear", ids: [] });
      expect(ink.marks()).toEqual([{ kind: "stroke", id: "id0", by: "me", ink: "red", size: 1, pts: [1, 1, 2, 2] }]);
    });
  });
});

describe("drawing order", () => {
  it("keeps your line before a partner's that started after it", () => {
    const ink = book();
    ink.fill("blue", 1, 1);
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "red", size: 1, seq: 0, pts: [5, 5] });
    expect(ink.marks().map((mark) => mark.id)).toEqual(["id0", "p1"]);
  });

  it("keeps a partner's earlier line before one you start after it", () => {
    const ink = book();
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "red", size: 1, seq: 0, pts: [5, 5] });
    ink.begin("blue", 1, 1, 1);
    expect(ink.marks().map((mark) => mark.id)).toEqual(["p1", "id0"]);
  });

  it("lets a synced state's order override the order things arrived locally", () => {
    const ink = book();
    ink.applyRelay("sam", { kind: "stroke", id: "p1", by: "sam", ink: "red", size: 1, seq: 0, pts: [5, 5] });
    ink.begin("blue", 1, 1, 1);
    ink.sync(
      [
        { kind: "stroke", id: "id0", by: "me", ink: "blue", size: 1, pts: [1, 1] },
        { kind: "stroke", id: "p1", by: "sam", ink: "red", size: 1, pts: [5, 5] },
      ],
      false,
    );
    expect(ink.marks().map((mark) => mark.id)).toEqual(["id0", "p1"]);
  });
});

describe("pointer to grid", () => {
  it("scales to the 1000 × 750 grid, rounds, and clamps", () => {
    const rect = { left: 10, top: 20, width: 500, height: 375 };
    expect(toGrid(260, 207.5, rect)).toEqual([500, 375]);
    expect(toGrid(-50, 9999, rect)).toEqual([0, 750]);
  });

  it("never divides by zero: a rect with no width or height still clamps to finite numbers", () => {
    expect(toGrid(50, 50, { left: 10, top: 20, width: 0, height: 0 })).toEqual([0, 0]);
  });
});
