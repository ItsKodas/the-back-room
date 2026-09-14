import type { TableView } from "@backroom/game-death-roll";
import { passMargin, roundFor } from "@backroom/game-death-roll";

/**
 * What the felt says about a round, worked out rather than drawn.
 *
 * Kept apart from the component so the words and the odds can be tested
 * without rendering anything — and because both are displays of rules the
 * table enforces, never the thing enforcing it.
 */

const nameOf = (state: TableView, seatId: string) =>
  state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";

/**
 * The chance the player to roll goes out this round, if everybody plays well.
 *
 * Read from the same solved round the bot plays, so the number on the felt is
 * the number the game is actually played to. Null when nobody is to roll.
 */
export function goesOut(state: TableView): number | null {
  if (state.phase !== "playing" || state.toRoll === null) {
    return null;
  }
  const at = state.alive.indexOf(state.toRoll);
  if (at === -1 || state.alive.length < 2) {
    return null;
  }
  let holders = 0;
  state.alive.forEach((seatId, position) => {
    const seat = state.seats.find((one) => one.id === seatId);
    if (seat !== undefined && !seat.passed) {
      holders |= 1 << position;
    }
  });
  const players = state.alive.length;
  const round = roundFor(players, passMargin(players, state.ante, state.passPrice));
  return round.risk(state.ceiling, at, holders, state.passedTo === state.toRoll)[at] ?? null;
}

/**
 * The move, spelled out.
 *
 * With a pass that cannot be handed back, where a pass lands is the thing a
 * player has to read, so the line names it; and a roll that arrived by a pass
 * says so, since that is why the pass button is not there.
 */
export function moveLine(state: TableView, seatId: string | null): string | null {
  const toRoll = state.toRoll;
  if (toRoll === null) {
    return null;
  }
  const mine = toRoll === seatId;
  const forced = state.passedTo === toRoll && state.lastPass !== null;
  if (forced) {
    const passer = nameOf(state, (state.lastPass as { seatId: string }).seatId);
    return mine
      ? `Your roll — ${passer} passed it to you, so you must roll`
      : `${nameOf(state, toRoll)}'s roll — ${passer} passed it to them, so they must roll`;
  }
  if (!mine) {
    return `${nameOf(state, toRoll)} to roll`;
  }
  const holds = state.seats.find((seat) => seat.id === toRoll)?.passed === false;
  const next = passesTo(state);
  return holds && next !== null
    ? `Your roll — roll it, or pass it to ${nameOf(state, next)}`
    : "Your roll";
}

/** Who a pass by the player to roll would land on: the next player still in. */
export function passesTo(state: TableView): string | null {
  if (state.toRoll === null) {
    return null;
  }
  const at = state.alive.indexOf(state.toRoll);
  return state.alive[(at + 1) % state.alive.length] ?? null;
}
