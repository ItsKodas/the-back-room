import { describe, expect, it } from "vitest";
import { Escrow } from "./escrow.js";

describe("what a table is holding for the people at it", () => {
  it("adds up what each account has put down", () => {
    const escrow = new Escrow();
    expect(escrow.hold("u1", 100)).toBe(true);
    escrow.hold("u1", 50);
    escrow.hold("u2", 20);
    expect(escrow.heldBy("u1")).toBe(150);
    expect(escrow.total).toBe(170);
  });

  it("lets chips that went back by an ordinary route come off", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.release("u1", 40);
    expect(escrow.heldBy("u1")).toBe(60);
    escrow.release("u1", 60);
    expect(escrow.heldBy("u1")).toBe(0);
    expect(escrow.total).toBe(0);
  });

  it("queues a leaver's chips rather than paying them, because a seat cannot await", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.hold("u2", 30);
    escrow.refund("u1");
    expect(escrow.heldBy("u1")).toBe(0);
    expect(escrow.due).toEqual([{ userId: "u1", chips: 100 }]);
    expect(escrow.takeDue()).toEqual([{ userId: "u1", chips: 100 }]);
    expect(escrow.due).toEqual([]);
    expect(escrow.total).toBe(30);
  });

  it("queues only part of an account when told how much", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.refund("u1", 70);
    expect(escrow.heldBy("u1")).toBe(30);
    expect(escrow.takeDue()).toEqual([{ userId: "u1", chips: 70 }]);
  });

  it("never queues more than an account holds", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 10);
    escrow.refund("u1", 500);
    escrow.refund("u2");
    expect(escrow.takeDue()).toEqual([{ userId: "u1", chips: 10 }]);
  });

  it("hands the round's stakes over once it is decided", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.hold("u2", 50);
    expect(escrow.settle()).toEqual([
      { userId: "u1", chips: 100 },
      { userId: "u2", chips: 50 },
    ]);
    expect(escrow.total).toBe(0);
    expect(escrow.hold("u1", 10)).toBe(true);
  });

  it("gives up everything on closing, the queue included, and refuses what arrives later", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    escrow.hold("u2", 50);
    escrow.refund("u2");
    const owed = escrow.close();
    expect(owed).toEqual([
      { userId: "u2", chips: 50 },
      { userId: "u1", chips: 100 },
    ]);
    expect(escrow.closed).toBe(true);
    expect(escrow.total).toBe(0);
    expect(escrow.due).toEqual([]);
    expect(escrow.hold("u1", 5)).toBe(false);
    expect(escrow.close()).toEqual([]);
  });

  it("says how much actually came off, so nothing is handed back twice", () => {
    const escrow = new Escrow();
    escrow.hold("u1", 100);
    expect(escrow.release("u1", 40)).toBe(40);
    expect(escrow.release("u1", 500)).toBe(60);
    escrow.hold("u2", 30);
    escrow.close();
    expect(escrow.release("u2", 30)).toBe(0);
  });
});
