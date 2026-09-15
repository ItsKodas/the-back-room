import type { GameAdapter } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { blindsFor, POKER, stakeFor } from "./listing.js";
import { decide, thinkingTime } from "./bot.js";
import type { Move } from "./table.js";
import { Table } from "./table.js";

/**
 * What the room does with a poker table.
 *
 * The interesting difference from the other two is where money is. Blackjack
 * takes a stake as it is placed and pays a hand out; poker takes chips off an
 * account once, when somebody sits down, and gives back whatever is in front
 * of them when they stand up. Everything between those two moments is stacks
 * moving around a table, which is why the rules never touch the economy.
 *
 * That is also what makes poker need no bank. Every chip a player wins came
 * off another player at the same table, so the room can hand out nothing it
 * was not handed first — the rule the whole building rests on, satisfied by
 * the shape of the game rather than by an argument about it.
 */

/** How long somebody gets to act before the table folds for them. */
const TURN_MS = 30_000;

/** How long a finished hand stays up to be read. */
const SHOWDOWN_MS = 5_000;

/**
 * And how much longer each side pot adds.
 *
 * The felt gives every pot its own announcement rather than listing them all
 * at once, so the wait has to grow with them. It matches the step the felt
 * uses; the two are a pair, and a table that cleared before the last one was
 * read would be worse than not announcing them separately at all.
 */
const MOMENT_MS = 2_400;

export function pokerAdapter(
  options: {
    random?: () => number;
    turnMs?: number;
    showdownMs?: number;
  } = {},
): GameAdapter<Table> {
  const random = options.random ?? Math.random;
  const turnMs = options.turnMs ?? TURN_MS;
  const showdownMs = options.showdownMs ?? SHOWDOWN_MS;

  return {
    listing: POKER,

    create(code, made) {
      /*
       * One number decides all three. The host picks what it costs to sit
       * down; the blinds follow from it at a hundred big blinds to the buy-in,
       * which is the shape of a small game everywhere — and means the stakes
       * cannot end up disagreeing with the price of entry.
       */
      const entry = stakeFor(made?.["buyIn"]);
      const blinds = blindsFor(entry);
      return new Table(
        code,
        random,
        blinds.small,
        blinds.big,
        seatLimit(made?.["maxSeats"], POKER.maxSeats),
        turnMs,
        made?.["forFun"] === true,
        entry,
      );
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; amount?: number };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }

      switch (move.type) {
        case "buyIn": {
          /*
           * Chips onto the table, taken from the account first.
           *
           * In that order, always: the seat gets nothing until the economy has
           * said the chips were there, so a refused buy-in leaves a seat with
           * an empty stack rather than a table with chips nobody paid for.
           */
          if (seat.stack > 0) {
            throw new TableError("You already have chips on the table.");
          }
          /*
           * A table playing for nothing asks the economy for nothing. The
           * stack is made up on the spot and dies with the table, so there is
           * no account to take it from and none to give it back to.
           */
          if (table.forFun) {
            table.buyIn(seatId, table.entry);
            return;
          }
          if (seat.userId === null) {
            throw new TableError("Sign in to play for chips.");
          }
          if (!(await deps.take(seat.userId, table.entry))) {
            throw new TableError("Not enough chips to sit down.");
          }
          /*
           * And given straight back if the seat is gone or the table closed
           * while the chips were being taken: the stack never landed, so
           * nobody else can be holding them.
           */
          try {
            table.buyIn(seatId, table.entry);
          } catch (error) {
            await deps.give(seat.userId, table.entry);
            throw error;
          }
          return;
        }
        case "show":
          table.show(seatId);
          return;
        /*
         * Taking chips back off the table. The table queues what it owes on
         * the escrow's queue and `payOut` hands it over on the next
         * broadcast — the same path a seat standing up uses, so there is one
         * way chips leave a poker table and not two.
         */
        case "cashOut":
          table.takeOffTable(seatId);
          return;
        case "fold":
        case "check":
        case "call":
        case "allIn":
          table.act(seatId, move.type as Move);
          return;
        case "raise":
          table.act(seatId, "raise", Number(move.amount));
          return;
        default:
          throw new TableError("That is not a move.");
      }
    },

    /*
     * A hand that has finished, which is not the same as chips being owed.
     *
     * The room latches this: once per stretch of being settled, which for
     * poker is once per showdown, because a showdown stays on screen for a
     * moment and then the felt clears. That is exactly the shape the latch
     * wants, and it is what makes `winners` below get asked at all — the room
     * only asks a settled table who won.
     *
     * What poker owes an *account* is a different question with a different
     * answer, and it is not this one. That is what somebody took with them
     * when they stood up: the escrow's queue rather than a state, paid
     * through `payOut`, which is deliberately outside the latch. A queue
     * behind a latch pays whoever was first and swallows everybody behind
     * them.
     */
    isSettled(table) {
      return table.street === "showdown";
    },

    async settle() {
      /*
       * Nothing. A poker hand has already moved its chips by the time it is
       * settled — they went from stacks into the pot and back into a stack,
       * and none of that was ever an account's. The table is settled so that
       * the room knows to ask who won; the money is not the room's business
       * until somebody stands up.
       */
    },

    /**
     * Who just won, for the things outside the game that ride on it.
     *
     * Answered for a for-fun table as well, and that is the point: a taunt
     * thrown at a player is paid for in real chips whatever the table is
     * dealing for, so winning a friendly hand has to come good the same way.
     */
    winners(table) {
      return table.paid.map((one) => one.seatId);
    },

    async payOut(table, deps) {
      /*
       * Drained rather than read, and drained before the first await. The
       * table carries on dealing while this yields, and somebody else standing
       * up mid-payment would otherwise be paid twice or not at all.
       */
      const owed = table.escrow.takeDue();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
    },

    /** Calls the table off: every stack and every bet, back to whoever brought it. */
    async void(table, deps) {
      const owed = table.escrow.close();
      for (const one of owed) {
        await deps.give(one.userId, one.chips);
      }
      return owed;
    },

    /*
     * A bot's turn, or nothing.
     *
     * Only ever at a table playing for nothing — the table refuses to seat one
     * anywhere else, so by the time there is a bot here the question of real
     * chips has already been settled.
     */
    botMove(table) {
      if (table.toAct === null) {
        return null;
      }
      const seat = table.seats.find((one) => one.id === table.toAct);
      if (seat === undefined || !seat.isBot) {
        return null;
      }
      const skill = seat.skill ?? "normal";
      const owed = table.owed(seat);
      const minRaiseTo = Math.min(table.minRaise(seat) + seat.committed, seat.committed + seat.stack);
      const choice = decide(
        seat,
        table,
        owed,
        minRaiseTo,
        seat.committed + seat.stack,
        skill,
        random,
      );

      return {
        seatId: seat.id,
        delayMs: thinkingTime(skill),
        play() {
          /*
           * Checked again on the way in. A bot thinks for the best part of a
           * second, and a table does not stop for it — somebody may have left
           * and moved the turn on, and a move sent for a seat whose turn it no
           * longer is would throw with nobody behind it to hear.
           */
          if (table.toAct !== seat.id) {
            return;
          }
          if (choice.move === "raise" && choice.to !== undefined) {
            table.act(seat.id, "raise", choice.to);
            return;
          }
          table.act(seat.id, choice.move);
        },
      };
    },

    clock(table) {
      const endsAt = table.turnEndsAt;
      if (table.toAct === null || endsAt === null) {
        return null;
      }
      // The table's own deadline, which is also the one it puts in the view —
      // so what runs out on screen is what runs out here.
      return { seatId: table.toAct, endsAt };
    },

    timeout(table, seatId) {
      /*
       * Checking rather than folding where it is free.
       *
       * Somebody whose connection died should not be made to throw away a hand
       * they had already paid to see. Folding a hand that owes nothing is the
       * one timeout that costs the player something they had not agreed to.
       */
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        return;
      }
      table.act(seatId, table.owed(seat) > 0 ? "fold" : "check");
    },

    pause(table) {
      /*
       * Two waits, and they are different waits — hence the names. A showdown
       * is held so it can be read; a table between hands is waiting for a
       * second player, and asking again in a second is how it notices one has
       * arrived.
       */
      if (table.street === "showdown") {
        /*
         * Long enough to say all of it.
         *
         * The felt announces the pots one at a time so every winner gets a
         * moment rather than sharing one — and a fixed wait would clear the
         * felt in the middle of the second announcement. The main pot gets the
         * base wait and each side pot adds its own turn.
         */
        const moments = Math.max(1, new Set(table.paid.map((one) => one.pot)).size);
        return {
          key: "showdown",
          ms: showdownMs + (moments - 1) * MOMENT_MS,
          run() {
            table.finish();
          },
        };
      }
      if (table.street === "waiting" && table.canDeal) {
        return {
          key: "deal",
          ms: 1_500,
          run() {
            if (table.canDeal) {
              table.deal();
            }
          },
        };
      }
      return null;
    },
  };
}
