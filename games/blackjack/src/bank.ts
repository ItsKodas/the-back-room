/**
 * What a table can owe, and the stake cap that keeps it coverable.
 *
 * Blackjack pays the player from somewhere. Until this existed that somewhere
 * was nowhere: stakes were taken off the account and winnings handed back, so
 * a table where the players beat the dealer created chips and one where they
 * lost destroyed them. The house edge made it roughly balance over a long
 * enough run, which is not the same as never minting — and "roughly, eventually"
 * is exactly the argument this building does not accept about its money.
 *
 * So a bank, filled by the stakes of everybody who has played here, and a cap
 * derived from the worst hand the rules permit rather than from a percentile.
 * The same footing the machine stands on, and it has to be earned the same way.
 */

/**
 * The most hands one seat can end up playing.
 *
 * A pair splits once and a split hand cannot split again, which is what holds
 * this to two — and holds this whole file to arithmetic somebody can check.
 */
export const MAX_HANDS = 2;

/** What doubling multiplies a hand's bet by. */
export const DOUBLE = 2;

/** What a winning hand hands back, stake included. */
export const WIN_RETURN = 2;

/** What a dealt blackjack hands back: three to two, with the stake alongside. */
export const BLACKJACK_RETURN = 2.5;

/**
 * The candidate worst hands, in units of the opening bet.
 *
 * Two of them, and it is the second that binds — the same shape as the
 * machine's. Each is what the seat gets back and what it put up to get there,
 * because the bank only has to find the difference: every stake is in the bank
 * before the cards are settled.
 *
 *   dealt blackjack      back 2.5, staked 1   → the bank finds 1.5
 *   split, both doubled,
 *   both won             back 8,   staked 4   → the bank finds 4
 *
 * The second is worse despite the first paying the better rate, because
 * splitting and doubling put four times the bet on the felt to be paid at even
 * money — a rate below three to two, on a great deal more money.
 */
const WORST: ReadonlyArray<{ back: number; staked: number }> = [
  { back: BLACKJACK_RETURN, staked: 1 },
  { back: MAX_HANDS * DOUBLE * WIN_RETURN, staked: MAX_HANDS * DOUBLE },
];

/**
 * What the bank has to hold per chip of opening bet.
 *
 * Derived rather than chosen, and derived here rather than in a comment: the
 * numbers above come from the rules in table.ts, and a rule change that made
 * the game more generous has to move this with it.
 *
 * Four, on today's rules. Nothing like the machine's fourteen hundred, and for
 * a plain reason: a slot machine can pay nine lines at once and a share of its
 * own bank on top, where a blackjack seat can hold at most two hands.
 */
export const STAKE_DIVISOR = Math.ceil(
  Math.max(...WORST.map((hand) => hand.back - hand.staked)),
);

/**
 * The largest opening bet this bank can certainly pay out on.
 *
 * A cap rather than a refusal, deliberately, and for the same reason the
 * machine has one: a table that will not deal until its bank is fat is dark
 * exactly when it is newest, and every quiet week would close it again. A
 * table that offers smaller stakes instead is always playable, and playing it
 * is what fills the bank back up.
 */
export function maxStake(bank: number): number {
  return Math.max(0, Math.floor(Math.max(0, bank) / STAKE_DIVISOR));
}

/**
 * The most this bank could owe one seat that opened at this bet.
 *
 * It exists so the guarantee can be tested as a property across many banks
 * rather than asserted about one, and so the reasoning above is executable
 * instead of a comment somebody has to trust.
 *
 * Returned in the same terms as the rules: what goes back to the player, and
 * what the player put up along the way.
 */
export function worstCase(stake: number): { back: number; staked: number } {
  let worst = { back: 0, staked: 0 };
  for (const hand of WORST) {
    /*
     * Floored, because that is what the table does — `Math.floor(bet * 1.5)`
     * on a blackjack. Rounding up here would have the cap defend against a
     * payout larger than the game can actually make, which is safe but is not
     * the number this file claims to be.
     */
    const back = Math.floor(hand.back * stake);
    const staked = hand.staked * stake;
    if (back - staked > worst.back - worst.staked) {
      worst = { back, staked };
    }
  }
  return worst;
}

/**
 * The most this bank could owe a whole round that opened at these bets.
 *
 * `worstCase` answers about a seat, and a blackjack round is not a seat: the
 * dealer turns one hand over and every seat at the table settles against it,
 * so a felt of six players each holding the cap is six times the exposure the
 * cap was derived to cover. The bank ran out partway down the row and the last
 * winner was handed their stake back instead of their winnings — nothing
 * minted, which is why it was quiet, and somebody short-paid all the same.
 *
 * Summed rather than multiplied, because `worstCase` floors and a sum of
 * floors is not the floor of a sum. It is the same shape as its per-seat
 * cousin for the same reason: what goes back to the players, and what they put
 * up along the way, so the guarantee reads identically at either size.
 */
export function roundWorstCase(stakes: Iterable<number>): { back: number; staked: number } {
  let back = 0;
  let staked = 0;
  for (const stake of stakes) {
    const worst = worstCase(stake);
    back += worst.back;
    staked += worst.staked;
  }
  return { back, staked };
}

/**
 * The largest opening bet a seat may add to a round already carrying these.
 *
 * The cap as a budget for the felt rather than an allowance per chair. `bank`
 * is what the bank holds that this round has no claim on yet — the stakes
 * already down are in there, and they are the very chips those seats may have
 * to be paid out of, so they buy nobody else a bigger hand.
 *
 * With an empty felt this is exactly `maxStake`, which is the point: the old
 * answer was never wrong, only incomplete.
 */
export function maxStakeAgainst(bank: number, committed: Iterable<number>): number {
  const round = roundWorstCase(committed);
  return maxStake(bank - (round.back - round.staked));
}

/**
 * The most one seat's hands could still take out of the bank.
 *
 * Stakes back included, and less any stake the seat has yet to put up to get
 * there — the same terms as `maxStakeAgainst`, because this is what the other
 * tables paid from this bank are told a felt is holding. Before the deal a
 * hand is worth exactly what the round budget allowed for it: split, both
 * doubled, both won, less the three stakes still to come, plus the one down.
 *
 * It never grows faster than the bank does. A split or a double adds as much
 * here as it adds to the stakes in the bank, and every other card only takes
 * a possibility away — which is why neither needs to be capped as it happens.
 */
export function stillOwed(
  hands: ReadonlyArray<{
    bet: number;
    cards: readonly unknown[];
    done: boolean;
    fromSplit: boolean;
  }>,
): number {
  let total = 0;
  for (const hand of hands) {
    const open = !hand.done && hand.cards.length <= 2;
    if (open && !hand.fromSplit && hands.length === 1) {
      const worst = worstCase(hand.bet);
      total += worst.back - worst.staked + hand.bet;
    } else if (open) {
      // Doubled and won, less the double still to come.
      total += DOUBLE * hand.bet * WIN_RETURN - (DOUBLE - 1) * hand.bet;
    } else if (hand.cards.length === 2 && !hand.fromSplit) {
      // Could be a dealt blackjack, which is the better return.
      total += Math.floor(BLACKJACK_RETURN * hand.bet);
    } else {
      total += WIN_RETURN * hand.bet;
    }
  }
  return total;
}
