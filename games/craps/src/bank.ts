import { OUTCOMES } from "./dice.js";
import { back, type Hand, multiplier, ratioOf } from "./resolve.js";
import type { Kind, Spot } from "./spots.js";

/**
 * The tray, and why it is what it is.
 *
 * Thirty rather than the twenty-five the wheel and the card tables use, and
 * the reason is arithmetic rather than taste. Craps pays in sixths, fifths,
 * halves and quarters — 7 to 6 on the six, 3 to 2 on odds behind the five, a
 * horn split four ways — and a tray of twenty-fives cannot pay any of them in
 * whole chips. A twenty-five on the six owes 29.166.
 *
 * A real table solves this by demanding multiples: the six and eight take
 * multiples of six, the odds behind the five take an even number. Thirty is
 * divisible by 2, 3, 5 and 6, so every denomination here pays every bet on
 * this cloth exactly and no spot has to demand anything — which is a much
 * better table to sit at than one that refuses your chip and explains why.
 *
 * Rounding was considered and rejected in both directions. Rounding down
 * shaves the player on free odds, whose entire point is that they carry no
 * edge. Rounding up pays 30 on a 30 place-six, which is true odds — it deletes
 * the house edge and the bank never fills.
 */
export const CHIPS = [3000, 1500, 600, 300, 150, 60, 30] as const;

/** The smallest thing anybody can put on a spot. */
export const MIN_CHIP = CHIPS[CHIPS.length - 1];

/**
 * The one exception to "every chip pays every bet".
 *
 * The horn's price has a four in the denominator, so the stake must divide by
 * four. Thirty does not; sixty does, and sixty is in the tray, so this costs
 * nobody a bet they wanted.
 */
export const HORN_STEP = MIN_CHIP * 2;

/**
 * What the table can be asked to pay, and what the bank must hold to promise
 * it.
 *
 * Craps shares roulette's shape and takes it one step further. A wheel settles
 * everybody at once, so the exposure is worked out across the whole cloth
 * rather than per seat — a cap derived per seat would be a promise about one
 * player made in front of eight. This cloth does that too, over thirty-six
 * ordered outcomes rather than thirty-seven pockets, and with a `hand`
 * argument because the same chip resolves differently on a come-out.
 *
 * What is new here is that a bet can survive the roll that did not resolve it.
 * That makes the cap below exact for the roll in front of it and no further —
 * a place bet's liability is a geometric tail, and a cap that tried to cover
 * every future roll would be either infinite or a guess in arithmetic's
 * clothing. The guarantee lives in {@link working} instead, which is asked
 * before every roll and so is never stale.
 */

/** A chip, or a pile of them, sitting on one spot. */
export interface Bet {
  readonly spot: Spot;
  readonly chips: number;
  /**
   * Not acting this roll.
   *
   * Two quite different reasons, deliberately one flag: asleep because its
   * owner is sitting out the come-out, or off because the bank cannot carry
   * it. Both mean the same thing to the dice — the chips are untouched, the
   * bet neither wins nor loses — and a second flag would only invite code
   * that honoured one and forgot the other.
   */
  readonly off: boolean;
}

/**
 * What the bank must hold per chip of the worst lone bet.
 *
 * Not used to cap anything — {@link headroom} does that exactly — but it is
 * the worst ratio this cloth can produce, it is what the admin desk quotes
 * when it asks what a bank could take at all, and having it written down is
 * what makes the figure in the tests something a person can check.
 */
export const STAKE_DIVISOR = 30;

/**
 * What a table playing for nothing starts with.
 *
 * Both live on the table and are gone when it closes, which is the whole rule
 * about play money. Seeded well past the tray's largest chip so the rail is
 * playable from the first roll rather than greying out until an imaginary bank
 * has filled.
 */
export const FUN_PURSE = 30_000;
export const FUN_BANK = 2_400_000;

/** Everything on the cloth, off or not: every chip of it is in the bank. */
export function staked(bets: readonly Bet[]): number {
  return bets.reduce((sum, one) => sum + one.chips, 0);
}

/** What one bet alone could be asked for on one roll. */
function most(bet: Bet, hand: Hand): number {
  let worst = 0;
  for (const roll of OUTCOMES) {
    const paid = back(bet.chips, multiplier(bet.spot, roll, hand));
    if (paid > worst) worst = paid;
  }
  return worst;
}

/**
 * The most this cloth could be asked for on one roll.
 *
 * The worst outcome, not the sum of every bet: the dice land one way, so two
 * props on different numbers expose the table to the larger of them rather
 * than to both. Bets that are off contribute nothing, because they cannot be
 * asked for anything — but their chips still count in {@link staked}, because
 * they are still in the bank.
 */
export function owed(bets: readonly Bet[], hand: Hand): number {
  let worst = 0;
  for (const roll of OUTCOMES) {
    let here = 0;
    for (const one of bets) {
      if (one.off) continue;
      here += back(one.chips, multiplier(one.spot, roll, hand));
    }
    if (here > worst) worst = here;
  }
  return worst;
}

/**
 * What the bank has to be holding for this cloth to be safe.
 *
 * A difference rather than the payout itself, because every stake enters the
 * bank as the chip lands: the table pays out of the bank *plus* what is on the
 * cloth.
 */
export function needed(bets: readonly Bet[], hand: Hand): number {
  return Math.max(0, owed(bets, hand) - staked(bets));
}

/**
 * The most that can still go on one spot, given what is already down.
 *
 * Solved rather than searched, and roulette's inequality generalised by one
 * step. Adding x chips to a spot raises what outcome o owes by x·mult(spot, o)
 * and raises the stakes by x, so for every outcome:
 *
 *     already[o] + x · mult(spot, o)  <=  bank + staked + x
 *     x · (mult(spot, o) - 1)         <=  bank + staked - already[o]
 *
 * The generalisation is that `mult` varies by outcome and not only by spot —
 * the field pays 1 to 1, 2 to 1 and 3 to 1 depending on what comes up, where
 * every roulette spot pays one figure. Outcomes where mult is one or less can
 * never bind, because the stake grows at least as fast as the liability, which
 * is also why money matched across the line needs no bank at all.
 *
 * Floored, because half a chip of headroom is no headroom.
 *
 * The bank goes in as it is, never clamped up to nought first. A clamp reads
 * like tidying and is the opposite: it hands the arithmetic a richer bank than
 * exists while the chips already on the cloth go on counting in full, and so
 * offers a chip the table cannot pay. And the bank can be below nought — every
 * craps table shares one, and a cap measured at one table counts the chips
 * another has put down.
 */
export function headroom(bank: number, bets: readonly Bet[], hand: Hand, spot: Spot): number {
  const already = staked(bets);
  let room = Number.POSITIVE_INFINITY;
  for (const roll of OUTCOMES) {
    const ratio = multiplier(spot, roll, hand);
    if (ratioOf(ratio) <= 1) continue;
    // (mult - 1) as a bare float loses the boundary: 11/5 - 1 lands a shade
    // above 1.2 in IEEE754, so a cap that sits exactly on the line — a place
    // bet's odds resolving to a whole number of chips — floors one short of
    // what the bank can truly carry. Multiplying through by the denominator
    // keeps the division exact wherever the true answer is a whole chip,
    // which is the only place this floor's answer is ever load-bearing.
    const [num, den] = ratio;
    let here = 0;
    for (const one of bets) {
      if (one.off) continue;
      here += back(one.chips, multiplier(one.spot, roll, hand));
    }
    const allowed = ((bank + already - here) * den) / (num - den);
    if (allowed < room) room = allowed;
  }
  /*
   * Nothing this spot can do would cost the bank more than the chip itself —
   * odds with no number behind them, which the table refuses on the way in
   * anyway. Bounded by the bank rather than left infinite, so the figure on
   * the felt is a number somebody could read.
   */
  if (!Number.isFinite(room)) {
    return Math.max(0, bank + already);
  }
  return Math.max(0, Math.floor(room));
}

/**
 * The order bets are taken off in when the bank cannot carry them all.
 *
 * The edged bets first and the fair ones last, and a contract last of all.
 * The one-roll middle goes, then the hardways, then the field and the numbers
 * — every one of them a bet the house holds something back on — and only then
 * the odds, which carry no edge at all and are the player's fair share of the
 * cloth. The line is last and in practice unreachable: getting there means the
 * bank is destitute, and the alternative to turning a contract off is failing
 * to pay a winner, which is worse.
 *
 * Deliberately not by the size of the promise. That question is settled inside
 * a kind rather than between kinds — see the tie-break in {@link working},
 * where two bets of the same sort go in the order of what they would cost.
 */
export const OFF_ORDER: readonly Kind[] = [
  "prop",
  "hard",
  "field",
  "place",
  "big",
  "odds",
  "travelled",
  "line",
];

/**
 * Which bets act on the roll in front of them.
 *
 * This is the table's whole guarantee, and it is the reason a place bet
 * staying up when it wins does not make this game unbounded. A place bet pays
 * every time its number comes before a seven, which is a run with no ceiling —
 * and "no ceiling but unlikely" is exactly what CLAUDE.md refuses. So rather
 * than capping placing against a future nobody can bound, the table asks this
 * question before every roll and turns bets off until the answer is yes.
 *
 * An off bet neither wins nor loses. The chips are untouched and still the
 * player's, and the bet comes back on the moment the bank can carry it or the
 * hand ends. "Off" is a state a real craps table already has, which is why
 * this reads as a rule of the game rather than an apology from the software.
 *
 * Two things follow. Overpaying becomes arithmetically impossible rather than
 * improbable. And every failure of this table falls on the player's side: a
 * bet that is off cannot lose.
 *
 * Nothing is ever turned back *on* here. A bet its owner put to sleep for the
 * come-out is their decision, and a bank with room to spare has no business
 * overruling it.
 */
export function working(bank: number, bets: readonly Bet[], hand: Hand): Bet[] {
  const off = bets.map((one) => one.off);
  const cover = staked(bets);
  const lay = (): Bet[] => bets.map((one, at) => ({ ...one, off: off[at] as boolean }));
  const carried = () => bank + cover >= owed(lay(), hand);

  if (carried()) {
    return lay();
  }

  const order = bets
    .map((one, at) => ({ at, one }))
    .filter(({ one }) => !one.off)
    .sort((a, b) => {
      const kinds = OFF_ORDER.indexOf(a.one.spot.kind) - OFF_ORDER.indexOf(b.one.spot.kind);
      return kinds !== 0 ? kinds : most(b.one, hand) - most(a.one, hand);
    });

  for (const { at } of order) {
    off[at] = true;
    if (carried()) break;
  }
  return lay();
}
