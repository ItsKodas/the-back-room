/**
 * What a death roll is worth to the person facing it.
 *
 * All of it follows from one number. The player about to roll at ceiling N
 * loses with probability 1/2 + 1/(N(N+1)) — the roller is always the underdog,
 * and by less and less as the ceiling rises. That is why passing is worth
 * almost nothing at the top of a duel and a great deal at the bottom, and why
 * the game has a decision in it at all.
 *
 * Nothing here knows about tables, seats or chips beyond a stake as a number.
 * The bot and the felt both read it, which is why it is its own file.
 */

/**
 * How much worse off the player about to roll is than even.
 *
 * The whole of the game's asymmetry, and small: a fiftieth at ceiling seven, a
 * millionth at a thousand.
 */
export function edge(ceiling: number): number {
  if (ceiling <= 1) {
    return 0.5;
  }
  return 1 / (ceiling * (ceiling + 1));
}

/**
 * The chance that whoever rolls next is the one who eventually rolls the 1.
 *
 * Checked against the recursion it stands in for rather than trusted: see
 * odds.test.ts, which writes the definition out in full.
 */
export function lossOdds(ceiling: number): number {
  return 0.5 + edge(ceiling);
}

/**
 * What handing the roll back is worth, in chips.
 *
 * Rolling is worth `-2 * ante * edge`; passing turns that around to
 * `+2 * ante * edge`, so the swing is four times the edge on the ante.
 */
export function passGain(ceiling: number, ante: number): number {
  return 4 * ante * edge(ceiling);
}

/**
 * What handing the roll back actually costs.
 *
 * Not the price — the price weighted by the chance you end up paying it. A
 * pass is only ever paid for by the loser, so a pass you buy and then win with
 * cost you nothing at all.
 */
export function passCost(ceiling: number, price: number): number {
  return price * (1 - lossOdds(ceiling));
}

/**
 * Whether spending the pass here is the right play.
 *
 * Deliberately strict rather than forgiving at the break-even ceiling: at
 * exactly even there is no reason to spend a thing you can only spend once.
 */
export function worthPassing(ceiling: number, ante: number, price: number): boolean {
  return passGain(ceiling, ante) > passCost(ceiling, price);
}
