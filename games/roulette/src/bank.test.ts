import { describe, expect, it } from "vitest";
import { STAKE_DIVISOR, headroom, needed, owed, staked } from "./bank.js";
import { type Spot, spotAt } from "./spots.js";
import { WHEEL } from "./wheel.js";

/* Every id here is a real spot; a typo should blow up the test, not be cast away. */
const at = (id: string): Spot => {
  const spot = spotAt(id);
  if (spot === null) throw new Error(`no such spot: ${id}`);
  return spot;
};

const bet = (id: string, chips: number) => ({ spot: at(id), chips });

describe("what the table can cover", () => {
  it("owes thirty-five times a lone straight-up, and no more", () => {
    const bets = [bet("straight:17", 100)];
    expect(owed(bets)).toBe(3_600);
    expect(staked(bets)).toBe(100);
    expect(needed(bets)).toBe(3_500);
    expect(needed(bets)).toBe(STAKE_DIVISOR * 100);
  });

  it("asks nothing of the bank when the bets cancel each other out", () => {
    /*
     * The point of doing this exactly rather than per seat. A table with equal
     * chips on red and on black pays one of them and keeps the other, so it
     * needs no bank at all — and a cap that charged each player for their own
     * worst case would refuse perfectly safe bets all night.
     */
    expect(needed([bet("even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36", 500), bet("even:2-4-6-8-10-11-13-15-17-20-22-24-26-28-29-31-33-35", 500)])).toBe(0);
  });

  it("takes the worst pocket, not the likeliest one", () => {
    // Two straight-ups on different numbers cannot both come in, so the table
    // is exposed to one of them rather than the sum.
    expect(needed([bet("straight:1", 100), bet("straight:2", 100)])).toBe(3_400);
  });

  it("adds up bets that share a pocket", () => {
    // 17 straight and the 17/20 split both come in on 17: 3,600 and 1,800.
    const bets = [bet("straight:17", 100), bet("split:17-20", 100)];
    expect(owed(bets)).toBe(5_400);
    expect(needed(bets)).toBe(5_200);
  });

  it("never asks for less than the worst pocket really costs", () => {
    /*
     * The guarantee, as a property rather than an example: whatever is on the
     * cloth, the bank plus every stake must cover the payout on any pocket the
     * ball can land in. This is the test that would catch a clever cap.
     */
    const bets = [
      bet("straight:0", 40),
      bet("corner:1-2-4-5", 70),
      bet("even:2-4-6-8-10-11-13-15-17-20-22-24-26-28-29-31-33-35", 250),
      bet("dozen:1-2-3-4-5-6-7-8-9-10-11-12", 130),
      bet("six:1-2-3-4-5-6", 60),
    ];
    const bank = needed(bets);
    for (const pocket of WHEEL) {
      const back = bets
        .filter((one) => one.spot.covers.includes(pocket))
        .reduce((sum, one) => sum + (one.chips * 36) / one.spot.covers.length, 0);
      expect(bank + staked(bets)).toBeGreaterThanOrEqual(back);
    }
  });

  it("says how much more can go on a spot before the bank runs out", () => {
    // A bank of 3,500 covers exactly 100 straight up and not a chip more.
    expect(headroom(3_500, [], at("straight:17"))).toBe(100);
    expect(headroom(3_500, [bet("straight:17", 100)], at("straight:17"))).toBe(0);
  });

  it("lets a bank go further on a bet that covers more", () => {
    // The same bank behind an even-money bet, which pays one to one.
    expect(headroom(3_500, [], at("even:2-4-6-8-10-11-13-15-17-20-22-24-26-28-29-31-33-35"))).toBe(3_500);
  });

  it("counts chips already on the cloth against the room left", () => {
    const left = headroom(3_500, [bet("straight:17", 40)], at("straight:17"));
    expect(left).toBe(60);
    expect(needed([bet("straight:17", 40 + left)])).toBeLessThanOrEqual(3_500);
  });

  it("offers nothing at all from an empty bank", () => {
    expect(headroom(0, [], at("straight:17"))).toBe(0);
    expect(headroom(-500, [], at("straight:17"))).toBe(0);
  });

  it("offers nothing on an overdrawn bank, even where the cloth has room of its own", () => {
    /*
     * The case the empty-cloth tests above cannot see. A straight-up on every
     * pocket pays 36 wherever the ball lands against 37 staked, so the cloth
     * over-covers itself by a chip and the position is legal even at a bank
     * of -1. Red is not covered by that spare chip, though: the true room is
     * -1 + 37 - 36, which is nothing. A bank clamped up to nought before the
     * arithmetic finds a chip that is not there, and a red pocket then owes 38
     * against 37.
     */
    const everyPocket = WHEEL.map((pocket) => bet(`straight:${pocket}`, 1));
    expect(owed(everyPocket)).toBeLessThanOrEqual(-1 + staked(everyPocket));
    expect(headroom(-1, everyPocket, at("even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36"))).toBe(0);
  });

  it("never offers a chip an overdrawn bank cannot cover, across a cloth already down", () => {
    /*
     * The same guarantee as the property below, but with chips already on the
     * cloth and banks below nought, which is the only place a clamped bank can
     * go wrong. Thirty-five on every pocket pays 1,260 against 1,295 staked, so
     * every bank down to -35 is a legal position to ask from. A negative bank
     * is not hypothetical: every roulette table shares one, and another table's
     * payout can take it below the chips this table has put in.
     */
    const cloth = WHEEL.map((pocket) => bet(`straight:${pocket}`, 35));
    for (const id of ["straight:17", "split:17-20", "corner:1-2-4-5", "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36"]) {
      const spot = at(id);
      for (const bank of [-35, -20, -1, 0]) {
        expect(owed(cloth)).toBeLessThanOrEqual(bank + staked(cloth));
        const most = headroom(bank, cloth, spot);
        const withIt = [...cloth, { spot, chips: most }];
        expect(owed(withIt)).toBeLessThanOrEqual(bank + staked(withIt));
      }
    }
  });

  it("never offers a chip the bank cannot actually cover", () => {
    /*
     * Property, across every kind of spot and a range of banks: take the
     * headroom this file offers, put exactly that on the cloth, and the bank
     * must still cover the worst pocket. An off-by-one here is a table that
     * cheerfully accepts a bet it cannot pay.
     */
    for (const id of ["straight:17", "split:17-20", "street:16-17-18", "corner:1-2-4-5", "six:1-2-3-4-5-6", "column:3-6-9-12-15-18-21-24-27-30-33-36"]) {
      const spot = at(id);
      for (const bank of [0, 1, 37, 500, 3_499, 3_500, 100_000]) {
        const most = headroom(bank, [], spot);
        expect(needed([{ spot, chips: most }])).toBeLessThanOrEqual(bank);
        if (most > 0) expect(needed([{ spot, chips: most + 1 }])).toBeGreaterThan(bank);
      }
    }
  });
});
