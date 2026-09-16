import type { ActResult, ChatRoute, GameAdapter } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { readBatch, readFill } from "./ink.js";
import { SCRIBBLE } from "./listing.js";
import { minimumPlayers, snapOptions } from "./options.js";
import type { Timings } from "./table.js";
import { ScribbleTable } from "./table.js";

export interface ScribbleAdapterOptions {
  now?: () => number;
  /*
   * Word choice and hint letters. Nothing is at stake, so the server may pass
   * nothing and Math.random will do; tests pass a source they can predict.
   */
  random?: () => number;
  timings?: Partial<Timings>;
}

export function scribbleAdapter(options: ScribbleAdapterOptions = {}): GameAdapter<ScribbleTable> {
  const clock = options.now ?? Date.now;

  return {
    listing: SCRIBBLE,

    create(code, made) {
      const chosen = snapOptions(made?.["scribble"]);
      const seats = seatLimit(made?.["maxSeats"], SCRIBBLE.maxSeats);
      const needed = minimumPlayers(chosen);
      if (seats < needed) {
        throw new TableError(
          chosen.mode === "teams"
            ? `${chosen.teams} teams need at least ${needed} seats.`
            : `Scribble needs at least ${needed} seats.`,
        );
      }
      return new ScribbleTable(code, seats, chosen, {
        now: clock,
        ...(options.random === undefined ? {} : { random: options.random }),
        ...(options.timings === undefined ? {} : { timings: options.timings }),
      });
    },

    act(table, seatId, action): ActResult | undefined {
      const move = action as Record<string, unknown>;
      switch (move["type"]) {
        case "pickTeam":
          table.pickTeam(seatId, move["team"] as number);
          return undefined;
        case "pick":
          table.pick(seatId, move["index"] as number);
          return undefined;
        case "stroke":
          return { relay: table.stroke(seatId, readBatch(move)) };
        case "fill":
          return { relay: table.fill(seatId, readFill(move)) };
        case "undo":
          return { relay: table.undo(seatId) };
        case "clear":
          return { relay: table.clear(seatId) };
        default:
          throw new TableError("That is not a move at this table.");
      }
    },

    chat(table, seatId, text): ChatRoute {
      return table.say(seatId, text);
    },

    isSettled(table) {
      return table.phase === "over";
    },

    // Nothing was staked, so there is nothing to pay and nothing to record.
    async settle() {},

    async void() {
      return [];
    },

    winners(table) {
      return table.winners;
    },

    pause(table) {
      const now = table.now();
      const wait = (until: number | null) => Math.max(0, (until ?? now) - now);
      switch (table.phase) {
        case "waiting":
          return table.deadline === null
            ? null
            : { key: `countdown:${table.game}`, ms: wait(table.deadline), run: () => table.deal() };
        case "picking":
          return { key: `pick:${table.turnNumber}`, ms: wait(table.deadline), run: () => table.autoPick() };
        case "drawing": {
          /*
           * One wait at a time: to the next hint, or to the end if there are
           * no more. Keyed on how many hints are showing, so each hint is its
           * own wait and the room re-arms for the next one after it runs.
           */
          const hint = table.nextHintAt();
          const until = hint === null ? table.deadline : Math.min(hint, table.deadline ?? hint);
          return {
            key: `draw:${table.turnNumber}:${table.hintsShown}`,
            ms: wait(until),
            run: () => table.advanceDrawing(),
          };
        }
        case "reveal":
          return { key: `reveal:${table.turnNumber}`, ms: wait(table.deadline), run: () => table.endReveal() };
        case "over":
          return { key: `over:${table.game}`, ms: wait(table.deadline), run: () => table.backToWaiting() };
      }
    },
  };
}
