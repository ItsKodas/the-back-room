import { describe, expect, it } from "vitest";
import { Readiness } from "./ready.js";

const four = ["ada", "bob", "cat", "dan"];

describe("getting a table dealt", () => {
  it("does nothing with one player ready", () => {
    const readiness = new Readiness(20_000);

    readiness.set("ada", true, four, 0);

    expect(readiness.countdownEndsAt).toBeNull();
    expect(readiness.dealable(four, 0)).toBeNull();
  });

  it("starts a countdown once two are ready, and deals the ready ones when it ends", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);

    readiness.set("bob", true, four, 1_000);

    expect(readiness.countdownEndsAt).toBe(21_000);
    expect(readiness.dealable(four, 20_999)).toBeNull();
    expect(readiness.dealable(four, 21_000)).toEqual(["ada", "bob"]);
  });

  it("deals at once when everybody is ready, however much countdown is left", () => {
    const readiness = new Readiness(20_000);
    for (const seat of four) {
      readiness.set(seat, true, four, 0);
    }

    expect(readiness.dealable(four, 0)).toEqual(four);
  });
});

describe("keeping the countdown honest", () => {
  it("is not restarted by more players getting ready", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 1_000);

    readiness.set("cat", true, four, 5_000);

    expect(readiness.countdownEndsAt).toBe(21_000);
  });

  it("is not restarted by somebody sitting down", () => {
    // Otherwise sitting down and standing up again would hold a table off for ever.
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 1_000);

    readiness.sync([...four, "eve"], 6_000);

    expect(readiness.countdownEndsAt).toBe(21_000);
  });

  it("is abandoned when fewer than two are ready", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 0);

    readiness.set("bob", false, four, 100);

    expect(readiness.countdownEndsAt).toBeNull();
    expect(readiness.dealable(four, 99_999)).toBeNull();
  });

  it("deals at once when the one player holding out stands up", () => {
    const three = ["ada", "bob", "cat"];
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, three, 0);
    readiness.set("bob", true, three, 0);

    readiness.drop("cat", ["ada", "bob"], 300);

    expect(readiness.dealable(["ada", "bob"], 300)).toEqual(["ada", "bob"]);
  });

  it("clears everybody, and the countdown, when a game ends or a deal fails", () => {
    const readiness = new Readiness(20_000);
    readiness.set("ada", true, four, 0);
    readiness.set("bob", true, four, 0);

    readiness.clear();

    expect(readiness.count(four)).toBe(0);
    expect(readiness.countdownEndsAt).toBeNull();
  });
});
