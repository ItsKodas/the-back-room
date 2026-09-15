import { TableError } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { InkLog, MAX_BATCH, MAX_POINTS, readBatch, readFill } from "./ink.js";

const batch = (id: string, seq: number, pts: number[], ink = "black" as const) => ({ id, seq, ink, size: 1, pts });

describe("reading a batch off the wire", () => {
  it("takes a well-formed batch", () => {
    expect(readBatch({ type: "stroke", id: "k1", seq: 0, ink: "red", size: 2, pts: [0, 0, 1000, 750] })).toEqual({
      id: "k1",
      seq: 0,
      ink: "red",
      size: 2,
      pts: [0, 0, 1000, 750],
    });
  });

  it("refuses anything a client could use to break the picture", () => {
    const good = { id: "k1", seq: 0, ink: "red", size: 1, pts: [1, 1] };
    for (const bad of [
      { ...good, id: "" },
      { ...good, id: "x".repeat(25) },
      { ...good, seq: -1 },
      { ...good, seq: 1.5 },
      { ...good, ink: "gold" },
      { ...good, size: 3 },
      { ...good, pts: [] },
      { ...good, pts: [1] },
      { ...good, pts: [1001, 0] },
      { ...good, pts: [0, 751] },
      { ...good, pts: [0.5, 1] },
      { ...good, pts: Array.from({ length: (MAX_BATCH + 1) * 2 }, () => 1) },
    ]) {
      expect(() => readBatch(bad), JSON.stringify(bad).slice(0, 60)).toThrow(TableError);
    }
  });

  it("reads a fill the same way", () => {
    expect(readFill({ id: "f1", ink: "blue", x: 10, y: 20 })).toEqual({ id: "f1", ink: "blue", x: 10, y: 20 });
    expect(() => readFill({ id: "f1", ink: "blue", x: -1, y: 20 })).toThrow(TableError);
  });
});

describe("the stroke log", () => {
  it("adds later batches to the same stroke, and relays each", () => {
    const log = new InkLog();
    expect(log.stroke("a", batch("k1", 0, [1, 1, 2, 2]))).toMatchObject({ kind: "stroke", id: "k1", by: "a", seq: 0 });
    log.stroke("a", batch("k1", 1, [3, 3]));
    expect(log.marks).toEqual([{ kind: "stroke", id: "k1", by: "a", ink: "black", size: 1, pts: [1, 1, 2, 2, 3, 3] }]);
    expect(log.points).toBe(3);
  });

  it("drops a batch it has already had, rather than drawing it twice", () => {
    const log = new InkLog();
    log.stroke("a", batch("k1", 0, [1, 1]));
    log.stroke("a", batch("k1", 1, [2, 2]));
    expect(log.stroke("a", batch("k1", 1, [2, 2]))).toBeNull();
    expect(log.points).toBe(2);
  });

  it("will not let one drawer add to the other's line", () => {
    const log = new InkLog();
    log.stroke("a", batch("k1", 0, [1, 1]));
    expect(() => log.stroke("b", batch("k1", 1, [2, 2]))).toThrow(TableError);
  });

  it("undoes only the undoer's own latest mark", () => {
    const log = new InkLog();
    log.stroke("a", batch("k1", 0, [1, 1]));
    log.stroke("b", batch("k2", 0, [2, 2]));
    log.fill("b", { id: "f1", ink: "red", x: 5, y: 5 });
    expect(log.undo("a")).toEqual({ kind: "undo", by: "a", id: "k1" });
    expect(log.marks.map((mark) => mark.id)).toEqual(["k2", "f1"]);
    expect(log.undo("a")).toBeNull();
  });

  it("does not bring an undone line back when a late batch for it arrives", () => {
    const log = new InkLog();
    log.stroke("a", batch("k1", 0, [1, 1]));
    log.undo("a");
    expect(log.stroke("a", batch("k1", 1, [2, 2]))).toBeNull();
    expect(log.marks).toEqual([]);
  });

  it("refuses a stroke that would overfill the napkin, and clearing makes room again", () => {
    const log = new InkLog();
    const pts = Array.from({ length: MAX_BATCH * 2 }, () => 1);
    let seq = 0;
    while (log.points + MAX_BATCH <= MAX_POINTS) {
      log.stroke("a", batch(`k${seq}`, 0, pts));
      seq += 1;
    }
    expect(() => log.stroke("a", batch("over", 0, pts))).toThrow("The napkin's full.");
    expect(log.clear()).toEqual({ kind: "clear" });
    expect(log.points).toBe(0);
    expect(log.stroke("a", batch("after", 0, pts))).not.toBeNull();
  });
});
