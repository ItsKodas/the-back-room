import { describe, expect, it } from "vitest";
import {
  type Bet,
  headroom,
  MIN_CHIP,
  needed,
  OFF_ORDER,
  owed,
  staked,
  STAKE_DIVISOR,
  working,
} from "./bank.js";
import { OUTCOMES } from "./dice.js";
import { type Hand, multiplier, ratioOf } from "./resolve.js";
import { SPOTS, type Spot, spotAt } from "./spots.js";

const at = (id: string) => spotAt(id) as Spot;
const bet = (id: string, chips: number, off = false): Bet => ({ spot: at(id), chips, off });
const comeOut: Hand = { point: null };
const on = (point: number): Hand => ({ point });

describe("what a roll can cost", () => {
  it("is the worst outcome, not the sum of the bets", () => {
    // The dice land one way. Two props on different numbers expose the table
    // to the larger of them, never to both, and a bank that added them up
    // would refuse most of the bets it could comfortably carry.
    const cloth = [bet("two", 30), bet("twelve", 30)];
    expect(owed(cloth, on(6))).toBe(30 * 31);
    expect(owed(cloth, on(6))).toBeLessThan(30 * 31 + 30 * 31);
  });

  it("needs no bank at all for money matched across the line", () => {
    // Equal chips on pass and don't pass can never both come in, so between
    // them they need nothing. A table that understands this takes bets all
    // evening that a cruder one refuses.
    const matched = [bet("pass", 300), bet("dontpass", 300)];
    expect(needed(matched, comeOut)).toBe(0);
  });

  it("counts a standing bet's winnings and not its stake", () => {
    // The six is still on the cloth after it pays, so its stake is not handed
    // over — and the stake is already in the bank, which is why a place six of
    // x needs only x/6 behind it.
    const cloth = [bet("place:6", 300)];
    expect(owed(cloth, on(9))).toBe(350);
    expect(needed(cloth, on(9))).toBe(50);
  });

  it("counts a bet that is off as nothing, but keeps its chips as cover", () => {
    const cloth = [bet("two", 30, true), bet("pass", 300)];
    // The prop cannot be asked for anything; its thirty still sits in the bank.
    expect(owed(cloth, comeOut)).toBe(600);
    expect(staked(cloth)).toBe(330);
    expect(needed(cloth, comeOut)).toBe(270);
  });

  it("agrees with the divisor the admin desk quotes", () => {
    // What the worst lone chip can do: a two or a twelve at thirty to one.
    const lone = [bet("two", MIN_CHIP)];
    expect(owed(lone, on(6)) - staked(lone)).toBe(MIN_CHIP * STAKE_DIVISOR);
  });
});

describe("what one more chip may be", () => {
  it("offers nothing when the bank is empty or overdrawn", () => {
    expect(headroom(0, [], on(6), at("two"))).toBe(0);
    // A bank below nought is possible: every craps table shares one, and a cap
    // measured here counts the chips another table has already put down.
    expect(headroom(-5_000, [], on(6), at("two"))).toBe(0);
  });

  it("offers exactly what the bank can carry, never a chip more", () => {
    // The property that matters, checked by taking the offer and re-measuring:
    // whatever headroom says is placeable must leave the cloth covered.
    for (const spot of SPOTS.values()) {
      for (const hand of [comeOut, on(6), on(4)]) {
        const bank = 100_000;
        const cloth = [bet("pass", 600), bet("place:8", 600)];
        const most = headroom(bank, cloth, hand, spot);
        /*
         * Spots that cannot cost the bank anything under this hand have no cap
         * to find — odds with no number behind them, which the table refuses on
         * the way in anyway. headroom answers with the bank itself there, which
         * is a figure to print rather than a ceiling to test against.
         */
        const binds = OUTCOMES.some((roll) => ratioOf(multiplier(spot, roll, hand)) > 1);
        if (!binds || most === 0) continue;
        const after = [...cloth, { spot, chips: most, off: false }];
        expect(needed(after, hand), `${spot.id} at ${most}`).toBeLessThanOrEqual(bank);
        const over = [...cloth, { spot, chips: most + 1, off: false }];
        expect(needed(over, hand), `${spot.id} at ${most + 1}`).toBeGreaterThan(bank);
      }
    }
  });

  it("lets the cloth lean on itself", () => {
    // A thousand already on don't pass means the come-out seven costs the
    // table nothing extra, so the pass line can take more than a bare bank
    // would allow. This is the whole return on walking every outcome.
    const bare = headroom(600, [], comeOut, at("pass"));
    const leaning = headroom(600, [bet("dontpass", 3_000)], comeOut, at("pass"));
    expect(leaning).toBeGreaterThan(bare);
  });
});

describe("the off rule", () => {
  it("leaves everything working when the bank can carry it", () => {
    const cloth = [bet("pass", 300), bet("place:6", 300), bet("two", 30)];
    expect(working(1_000_000, cloth, on(6)).every((one) => !one.off)).toBe(true);
  });

  it("turns bets off until the bank can carry what is left", () => {
    const cloth = [bet("pass", 3_000), bet("place:6", 3_000), bet("two", 3_000)];
    const after = working(0, cloth, on(6));
    const still = after.filter((one) => !one.off);
    expect(owed(still, on(6))).toBeLessThanOrEqual(staked(cloth));
  });

  it("takes the biggest promise off first, so the fewest bets go off", () => {
    // Props before hardways before the numbers before the line, and within a
    // kind the one that could cost the most. A rule that took them off in the
    // order they were laid would switch off six small bets to save one big one.
    const cloth = [bet("pass", 3_000), bet("two", 3_000), bet("hard:6", 3_000)];
    const after = working(0, cloth, on(6));
    const offIds = after.filter((one) => one.off).map((one) => one.spot.id);
    expect(offIds[0]).toBe("two");
    expect(offIds).not.toContain("pass");
  });

  it("never turns off more than it must", () => {
    const cloth = [bet("pass", 300), bet("two", 3_000)];
    const after = working(3_000, cloth, on(6));
    // Turning the prop off is enough; the line bet is well within the bank.
    expect(after.find((one) => one.spot.id === "two")?.off).toBe(true);
    expect(after.find((one) => one.spot.id === "pass")?.off).toBe(false);
  });

  it("never turns a bet back on that its owner put to sleep", () => {
    // The come-out rule is the player's, not the bank's. A bank with room to
    // spare must not wake somebody's place bet up on a come-out.
    const cloth = [bet("place:6", 300, true)];
    expect(working(1_000_000, cloth, comeOut)[0]?.off).toBe(true);
  });

  it("goes all the way off rather than promising what it cannot pay", () => {
    // A destitute bank is the one case where even the line goes off. That is
    // ugly and it is still the right answer: the alternative is failing to pay
    // a winner, and an off bet cannot lose.
    const cloth = [bet("pass", 3_000)];
    const after = working(-1_000_000, cloth, on(6));
    expect(after.every((one) => one.off)).toBe(true);
  });

  it("orders every kind on the cloth", () => {
    // A kind missing from the order would sort to the front by accident and
    // be the first thing switched off, which is a silent change of policy.
    const kinds = new Set([...SPOTS.values()].map((one) => one.kind));
    for (const kind of kinds) expect(OFF_ORDER).toContain(kind);
    expect(OFF_ORDER).toHaveLength(kinds.size);
  });
});
