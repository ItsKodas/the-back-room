import type { TableView } from "@backroom/game-liars-dice";

/**
 * The line over the felt saying what the table is waiting for.
 *
 * Here rather than in the component so there is a test per state; there are six
 * of them and the difference between "waiting on Bram" and "waiting for a
 * second player" is the difference between a table that works and one that
 * looks broken.
 */
export function whoseTurn(state: TableView, seatId: string | null): string {
  if (state.phase === "over") {
    const winner = state.seats.find((seat) => state.winnerIds.includes(seat.id));
    return winner === undefined ? "That is the game." : `${winner.name} took it.`;
  }
  if (state.phase === "waiting") {
    if (state.waitingFor === "players") {
      return "Waiting for a second player. Nothing is staked until the table deals.";
    }
    return state.readyCount === 0
      ? "Say you are in and the table will deal."
      : `${state.readyCount} of ${state.seats.length} are in.`;
  }
  if (state.resolution !== null) {
    return "Cups up.";
  }
  if (state.toAct === seatId) {
    return state.bid === null ? "You open." : "Your call.";
  }
  const name = state.seats.find((seat) => seat.id === state.toAct)?.name ?? "somebody";
  return `Waiting on ${name}.`;
}
