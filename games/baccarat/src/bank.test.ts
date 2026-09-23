import { describe, expect, it } from "vitest";
import type { Outcome } from "./coup.js";
import { type Bet, headroom, MIN_CHIP, needed, owed, STAKE_DIVISOR, staked } from "./bank.js";
import { back } from "./spots.js";

const bet = (spot: Bet["spot"], chips: number): Bet => ({ spot, chips });

/** What the cloth actually hands back if this outcome comes in. */
const paidOn = (bets: readonly Bet[], outcome: Outcome) =>
  bets.reduce((sum, one) => sum + back(one.spot, one.chips, outcome), 0);

const OUTCOMES: readonly Outcome[] = ["player", "banker", "tie"];

describe("what the cloth is staked and owed", () => {
  it("adds up every chip on it", () => {
    expect(staked([bet("player", 100), bet("tie", 25)])).toBe(125);
    expect(staked([])).toBe(0);
  });

  it("owes the worst of the three outcomes, not the sum of them", () => {
    // 100 on player: player pays 200, banker pays 0, a tie returns 100.
    expect(owed([bet("player", 100)])).toBe(200);
    // 100 on tie: the tie pays 900 and nothing else pays at all.
    expect(owed([bet("tie", 100)])).toBe(900);
  });

  it("is exact against what each outcome actually pays", () => {
    const cloth = [bet("player", 300), bet("banker", 125), bet("tie", 50)];
    const worst = Math.max(...OUTCOMES.map((outcome) => paidOn(cloth, outcome)));
    expect(owed(cloth)).toBe(worst);
  });

  it("needs from the bank only what the stakes do not already cover", () => {
    // Every stake is in the bank before anything is decided, so the table pays
    // out of the bank plus what is on the cloth.
    expect(needed([bet("player", 100)])).toBe(100); // owes 200, holds 100
    expect(needed([bet("tie", 100)])).toBe(800); // owes 900, holds 100
    expect(needed([])).toBe(0);
  });

  /*
   * The property that makes this table generous rather than merely safe.
   * Equal money on the two sides cannot both come in, and a tie returns both,
   * so between them they need no bank at all.
   */
  it("needs no bank at all for matched money", () => {
    expect(needed([bet("player", 500), bet("banker", 500)])).toBe(0);
    expect(needed([bet("player", 5000), bet("banker", 5000)])).toBe(0);
  });

  it("names the worst a lone chip can do", () => {
    // A tie at eight to one: a chip of x is owed 9x and holds x.
    expect(STAKE_DIVISOR).toBe(8);
    expect(needed([bet("tie", 100)])).toBe(100 * STAKE_DIVISOR);
  });
});

describe("the headroom on a spot", () => {
  /** Everything the cloth could be asked for, against everything it holds. */
  const covered = (bank: number, bets: readonly Bet[]) => owed(bets) <= bank + staked(bets);

  it("offers a chip the bank can cover, and not one more", () => {
    for (const spot of ["player", "banker", "tie"] as const) {
      for (const bank of [0, 25, 100, 999, 5_000, 123_456]) {
        const cloth: Bet[] = [];
        const most = headroom(bank, cloth, spot);
        if (most > 0) {
          expect(covered(bank, [...cloth, bet(spot, most)]), `${spot} ${bank}`).toBe(true);
        }
        expect(covered(bank, [...cloth, bet(spot, most + 1)]), `${spot} ${bank} + 1`).toBe(false);
      }
    }
  });

  it("is exact on a cloth that already has chips on it", () => {
    const cloth = [bet("player", 1000), bet("tie", 25)];
    for (const spot of ["player", "banker", "tie"] as const) {
      const bank = 10_000;
      const most = headroom(bank, cloth, spot);
      expect(covered(bank, [...cloth, bet(spot, most)]), spot).toBe(true);
      expect(covered(bank, [...cloth, bet(spot, most + 1)]), spot).toBe(false);
    }
  });

  /*
   * The banker line is 2x - ceil(x/20), which steps rather than sloping, so a
   * cap worked out by division would be wrong by up to five per cent in one
   * direction or the other. This is the case that catches it.
   */
  it("is exact on the banker spot, where the commission steps", () => {
    for (const bank of [19, 20, 21, 39, 40, 41, 1_000, 1_001, 99_999]) {
      const most = headroom(bank, [], "banker");
      expect(covered(bank, [bet("banker", most)]), `${bank}`).toBe(true);
      expect(covered(bank, [bet("banker", most + 1)]), `${bank} + 1`).toBe(false);
    }
  });

  /*
   * Matched money makes room rather than taking it.
   *
   * Player and Banker cannot both come in, and a tie returns both, so chips on
   * one side are what the other side's win is paid out of. The bank is the
   * same in both of these — the only difference is the thousand already on the
   * opposite side, and the table can take more than twice as much for it.
   */
  it("counts matched money as cover rather than exposure", () => {
    const alone = headroom(1_000, [], "banker");
    const matched = headroom(1_000, [bet("player", 1_000)], "banker");
    expect(alone).toBe(1_053);
    expect(matched).toBe(2_106);
  });

  /*
   * A cloth the bank cannot already cover takes nothing more, even though the
   * arithmetic has an interior band that would satisfy it.
   *
   * This is reachable: every baccarat table shares one bank, so another
   * table's payout can take it below what this cloth already needs. With a
   * thousand on Player and an empty bank, a thousand or more on Banker would
   * technically balance the books — Banker money is what Player money is paid
   * out of — but a table that answered that would be telling a player to stake
   * a minimum in order to rescue the house's shortfall. It refuses, and lets
   * the cloth settle on its own.
   */
  it("takes nothing more onto a cloth the bank cannot already cover", () => {
    expect(needed([bet("player", 1_000)])).toBe(1_000);
    expect(headroom(0, [bet("player", 1_000)], "banker")).toBe(0);
  });

  it("offers nothing out of an empty bank", () => {
    expect(headroom(0, [], "tie")).toBe(0);
    expect(headroom(0, [], "player")).toBe(0);
  });

  /*
   * The bank can be below nought: every baccarat table shares one, and a cap
   * measured at one table counts the chips another has put down. The bank goes
   * into the arithmetic as it is, never clamped up to nought first — clamping
   * the bank would hand the sum a richer bank than exists while the chips on
   * the cloth go on counting in full, and so offer a chip the table cannot pay.
   */
  it("offers nothing out of an overdrawn bank, and traps nobody's chips", () => {
    expect(headroom(-5_000, [], "player")).toBe(0);
    expect(headroom(-5_000, [bet("player", 100)], "tie")).toBe(0);
  });

  it("never offers less than the smallest chip without meaning it", () => {
    // A bank that can cover exactly one minimum chip on player offers it.
    expect(headroom(MIN_CHIP, [], "player")).toBeGreaterThanOrEqual(MIN_CHIP);
  });

  /*
   * The no-bank path, which a table built without one takes. Bisecting from
   * an upper bound past 2^53 never converges: the arithmetic stops being
   * exact, the midpoint stops moving, and the loop spins forever.
   */
  it("answers rather than hangs when the bank is effectively unlimited", () => {
    for (const spot of ["player", "banker", "tie"] as const) {
      const most = headroom(Number.MAX_SAFE_INTEGER, [], spot);
      expect(Number.isFinite(most), spot).toBe(true);
      expect(most, spot).toBeGreaterThan(0);
    }
  });
});
