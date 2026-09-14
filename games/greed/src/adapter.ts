import { DEFAULT_RULESET, RULESETS } from "@backroom/rules";
import { seatLimit, TableError } from "@backroom/core";
import type { BotMove, Clock, GameAdapter } from "@backroom/core";
import { comboGateKeyFor } from "./gatekey.js";
import { decide, thinkingTime } from "./bot.js";
import { Room } from "./room.js";
import type { Roller } from "./room.js";
import { GREED } from "./listing.js";

/**
 * What the room does with a Greed table.
 *
 * All of this used to live in the socket layer, where it was the reason the
 * server could only ever host one game: the turn clock, the bot's thinking,
 * the pause after a farkle and the sharing out of a pot are Greed's rules, not
 * a server's. They are here now and the server asks rather than knows.
 */
/**
 * A factory rather than a value, because the dice have to come from somewhere.
 * A test hands in a scripted roller and gets a table whose every throw is
 * known; production hands in nothing and gets real ones.
 */
export function greedAdapter(
  options: {
    roll?: Roller;
    /** How long the busting dice stay up. An argument so a test can hurry it. */
    pauseMs?: number;
  } = {},
): GameAdapter<Room> {
  const pauseMs = options.pauseMs ?? 1400;
  const roll: Roller =
    options.roll ??
    ((count) =>
      Array.from({ length: count }, () => (1 + Math.floor(Math.random() * 6)) as 1 | 2 | 3 | 4 | 5 | 6));

  return {
  listing: GREED,

  create(code, made) {
    const wanted = typeof made?.["ruleset"] === "string" ? made["ruleset"] : undefined;
    const chosen = RULESETS.find((candidate) => candidate.name === wanted) ?? DEFAULT_RULESET;
    return new Room(code, roll, chosen, seatLimit(made?.["maxSeats"], GREED.maxSeats));
  },

  /**
   * Greed's verbs.
   *
   * Money moves here rather than in the server because when it moves is part
   * of the rules: Greed takes every stake at the deal and pays the pot at the
   * end, and blackjack does neither.
   */
  async act(room, seatId, action, deps) {
    const move = action as { type?: string; index?: number; ruleset?: string };
    switch (move.type) {
      case "roll":
        room.doRoll(seatId);
        return;
      case "toggle":
        room.toggle(seatId, Number(move.index));
        return;
      case "bank":
        room.bank(seatId);
        return;
      case "playAgain":
        room.playAgain(seatId);
        return;
      case "start": {
        // Every stake before a card is dealt, and anything already taken put
        // back if one of them cannot pay. Nobody ends up half-way into a game.
        const paid: string[] = [];
        if (room.buyIn > 0) {
          for (const seat of room.seats) {
            if (seat.userId === null) {
              continue;
            }
            if (await deps.take(seat.userId, room.buyIn)) {
              paid.push(seat.userId);
            } else {
              for (const refund of paid) {
                await deps.give(refund, room.buyIn);
              }
              // A refusal, not a fault: it is shown to the player as it is.
              throw new TableError(`${seat.name} cannot cover the buy-in.`);
            }
          }
        }
        try {
          room.start(seatId);
        } catch (error) {
          for (const refund of paid) {
            await deps.give(refund, room.buyIn);
          }
          throw error;
        }
        return;
      }
      default:
        throw new TableError("That is not something you can do here.");
    }
  },

  isSettled(room) {
    return room.status === "over";
  },

  /**
   * Who reached the target, which the room has already worked out.
   *
   * Answered for a friendly as readily as for a game played for chips. `settle`
   * writes no record of a friendly, deliberately, but somebody still won it —
   * and a taunt staked on a player costs real chips whatever the table plays
   * for, so it has to come good on a result the history never mentions.
   */
  winners(room) {
    return room.winnerIds;
  },

  /** The pot to the winners, split evenly, remainder to the earliest seated. */
  async settle(room, deps) {
    const winners = room.seats.filter((seat) => room.winnerIds.includes(seat.id));
    /*
     * A game with nothing staked is a friendly, and a friendly goes on nobody's
     * record. Counting it made a win rate mean two different things at once —
     * six wins from nine, most of them practice — and left a history of rows
     * that all read +0. It is still a real game; it is just not a result.
     */
    const forChips = room.buyIn > 0;
    const share = winners.length > 0 ? Math.floor(room.pot / winners.length) : 0;
    const remainder = room.pot - share * winners.length;

    /*
     * What each winner was actually handed, kept rather than recomputed. The
     * remainder of an uneven split goes to one of them, so "the share" is not
     * what every winner got and the history would be a rounding error out.
     */
    /*
     * The whole result, read off the room before anything is awaited.
     *
     * Settlement talks to the economy, so it yields, and the room does not
     * stand still while it does: the host can start the next game, which zeroes
     * every score and empties the winners. A loop that read the room after an
     * await would record that new, empty game over the top of the one actually
     * played. The game is over; what it came to is a fact now, not a place to
     * look things up later.
     */
    const buyIn = room.buyIn;
    const table = { code: room.code, rulesetName: room.ruleset.name, pot: room.pot };

    /*
     * What each winner was handed, not what the share was. An uneven pot leaves
     * a remainder, it goes to the earliest seated of them, and a history that
     * recorded the share for everybody would be that remainder out.
     */
    const result = room.seats
      .filter((seat) => !seat.waiting)
      .map((seat) => ({
        userId: seat.userId,
        name: seat.name,
        score: seat.score,
        isBot: seat.isBot,
        seatId: seat.id,
        won: room.winnerIds.includes(seat.id),
        got:
          room.winnerIds.includes(seat.id) && winners[0] !== undefined
            ? share + (winners[0].id === seat.id ? remainder : 0)
            : 0,
      }));

    for (const seat of result) {
      if (seat.userId === null || seat.got <= 0) {
        continue;
      }
      await deps.give(seat.userId, seat.got);
    }

    // Somebody who arrived mid-game paid no stake and took no turn, and was
    // filtered out above along with the rest of the watchers.
    for (const seat of result) {
      if (seat.userId === null || !forChips) {
        continue;
      }
      await deps.record(seat.userId, {
        shared: {
          games: 1,
          wins: seat.won ? 1 : 0,
          chipsWon: seat.got - buyIn,
          chipsStaked: buyIn,
        },
        game: GREED.id,
        // A best turn is a maximum and only the game knows that.
        max: { bestTurn: seat.score },
      });
    }

    if (!forChips) {
      return;
    }

    await deps.finished({
      code: table.code,
      rulesetName: table.rulesetName,
      buyIn,
      pot: table.pot,
      players: result.map((seat) => ({
        userId: seat.userId,
        name: seat.name,
        score: seat.score,
        isBot: seat.isBot,
        net: seat.got - buyIn,
      })),
      winnerIds: result.filter((seat) => seat.won).map((seat) => seat.userId ?? seat.seatId),
      endedAt: Date.now(),
    });
  },

  clock(room): Clock | null {
    const seconds = room.ruleset.turnTimerSeconds;
    const active = room.activeSeat();
    if (seconds === null || seconds <= 0 || active === null || room.status !== "playing") {
      return null;
    }
    return { seatId: active.id, endsAt: Date.now() + seconds * 1000 };
  },

  timeout(room, seatId) {
    room.timeout(seatId);
  },

  botMove(room): BotMove | null {
    const seat = room.activeSeat();
    if (seat === null || !seat.isBot || room.status !== "playing") {
      return null;
    }
    const turn = room.view(null).turn;
    /*
     * Nothing to decide while the busting dice are still on screen or the game
     * is over. Without this the bot is asked again on every broadcast, tries to
     * roll into a finished turn, is refused, and the table books it again — a
     * loop that looks exactly like a bot that has stopped playing.
     */
    if (turn === null || turn.phase === "farkled" || turn.phase === "over") {
      return null;
    }
    const skill = seat.skill ?? "normal";
    return {
      seatId: seat.id,
      delayMs: thinkingTime(skill),
      play() {
        /*
         * A turn starts with a throw. The bot is asked what to keep only once
         * there are dice to look at — asked before that it has nothing to
         * decide, says so, and the table books it again on the next broadcast,
         * which is a loop that looks exactly like a bot that has stopped.
         */
        if (turn.phase === "awaiting_roll") {
          room.doRoll(seat.id);
          return;
        }
        if (turn.phase !== "selecting") {
          return;
        }
        const choice = decide({
          dice: turn.dice,
          kept: room.keptThisTurn,
          onBoard: seat.onBoard,
          mustBeat: room.deficitOnFinalTurn(),
          rules: room.ruleset,
          gateKey: comboGateKeyFor(room.ruleset),
          skill,
        });
        if (choice === null) {
          return;
        }
        for (const index of choice.keep) {
          room.toggle(seat.id, index);
        }
        if (choice.action === "bank") {
          room.bank(seat.id);
        } else {
          room.doRoll(seat.id);
        }
      },
    };
  },

  /** The busting dice stay on screen for a beat before play moves on. */
  pause(room) {
    if (room.view(null).turn?.phase !== "farkled") {
      return null;
    }
    return {
      key: "farkled",
      ms: pauseMs,
      // Not "then": an object with a then property is a thenable, and one that
      // reached an await by accident would hang rather than fail.
      run() {
        room.advanceTurn();
      },
    };
  },
  };
}
