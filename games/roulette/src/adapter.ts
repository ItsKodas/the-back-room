import type { BotMove, GameAdapter, GameDeps } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { headroom, staked } from "./bank.js";
import { toBets } from "./bets.js";
import { botBet, thinkingTime } from "./bot.js";
import { ROULETTE } from "./listing.js";
import { spotAt } from "./spots.js";
import { SETTLE_MS, SPIN_MS, Table, WINDOWS } from "./table.js";

/** What a table needs of the chips everybody before it has staked. */
export interface Bank {
  holds(): Promise<number>;
  add(amount: number): Promise<void>;
  /** Pays out, or returns false rather than overdrawing. */
  take(amount: number): Promise<boolean>;
}

/**
 * What the room does with a roulette table.
 *
 * The money is simpler than blackjack's and the timing is harder. Every chip
 * goes into the bank as it lands and nothing comes back out until the ball
 * does, so there is no per-hand settling to interleave — but the table is
 * always waiting on a clock rather than on a person, which means the pause
 * below is the entire engine.
 */
export function rouletteAdapter(
  options: {
    pick?: (pockets: number) => number;
    /** How long the felt is open for bets. An argument so a test can hurry it. */
    window?: number;
    /** How long the ball is in the air. */
    spinMs?: number;
    /** How long a finished spin stays up to be read. */
    settleMs?: number;
    /**
     * The bank these tables pay from, when there is one.
     *
     * Without it a table takes chips off accounts and hands winnings back with
     * nothing in between, which is a wheel that mints. With it, every chip is
     * in the bank before the ball is released and every payout comes out of
     * it, so the table can only ever hand over what somebody put there.
     */
    bank?: Bank;
  } = {},
): GameAdapter<Table> {
  const bank = options.bank ?? null;
  const spinMs = options.spinMs ?? SPIN_MS;
  const settleMs = options.settleMs ?? SETTLE_MS;

  /*
   * Where a table's money actually lives.
   *
   * Two entirely separate worlds behind one set of verbs, and keeping them
   * separate is the point. A for-fun table's purse and bank live on the table
   * and are gone when it closes; a chips table's live in the store and belong
   * to real people. A signed-in player sitting at a for-fun table must spend
   * the former, and a branch that got this wrong would quietly spend the
   * latter — which is a real balance, really gone.
   */

  const holds = async (table: Table): Promise<number> => {
    if (table.forFun) {
      return table.funBank;
    }
    return bank === null ? Number.MAX_SAFE_INTEGER : bank.holds();
  };

  /**
   * What the bank holds, not counting this spin's chips.
   *
   * The figure every cap is worked out against. Chips go into the bank as they
   * land, so what it holds mid-window already includes them — and `needed`
   * subtracts the stakes itself, so handing it the inflated figure would let
   * the cloth vouch for itself.
   */
  const base = async (table: Table): Promise<number> =>
    (await holds(table)) - staked(toBets(table.placed));

  /** Chips off the player and into the bank. False if they have not got them. */
  const stake = async (
    table: Table,
    seat: { id: string; userId: string | null },
    chips: number,
    deps: GameDeps,
  ): Promise<boolean> => {
    if (table.forFun) {
      if (table.purseFor(seat.id) < chips) {
        return false;
      }
      table.movePurse(seat.id, -chips);
      table.funBank += chips;
      return true;
    }
    if (seat.userId === null) {
      throw new TableError("Sign in to play for chips.");
    }
    if (!(await deps.take(seat.userId, chips))) {
      return false;
    }
    await bank?.add(chips);
    return true;
  };

  /** Chips out of the bank and back to the player. */
  const pay = async (
    table: Table,
    seat: { id: string; userId: string | null },
    chips: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (chips <= 0) {
      return;
    }
    if (table.forFun) {
      table.funBank -= chips;
      table.movePurse(seat.id, chips);
      return;
    }
    /*
     * Only if the bank actually holds it. The cap on every chip was worked out
     * against the worst pocket on this exact cloth, so this cannot refuse —
     * which is exactly why it is checked. The alternative is a bank going
     * negative in silence and a wheel that has quietly started minting.
     */
    if (bank !== null && !(await bank.take(chips))) {
      return;
    }
    if (seat.userId !== null) {
      await deps.give(seat.userId, chips);
    }
  };

  return {
    listing: ROULETTE,

    create(code, made) {
      const window = WINDOWS.includes(made?.["window"] as (typeof WINDOWS)[number])
        ? (made?.["window"] as number)
        : (options.window ?? WINDOWS[1]);
      const table = new Table(code, seatLimit(made?.["maxSeats"], ROULETTE.maxSeats), {
        pick: options.pick,
        window,
      });
      // Fixed when the table is opened: a table anybody may sit at and a table
      // that spends real chips are not the same game with a different label.
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; spotId?: string; chips?: number };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }

      switch (move.type) {
        case "place": {
          const spot = spotAt(move.spotId ?? "");
          if (spot === null) {
            throw new TableError("There is no such bet on this table.");
          }
          const chips = move.chips ?? 0;

          /*
           * What this spot can still take, worked out across the whole cloth.
           * Everybody's chips, not just this seat's: one wheel settles all of
           * them, so the table's exposure is a single shared number and a cap
           * that ignored the other seats would be a promise made in front of
           * people it did not count.
           */
          const most = headroom(await base(table), toBets(table.placed), spot);
          if (chips > most) {
            throw new TableError(
              most === 0
                ? "The bank cannot cover any more on that."
                : `The bank covers ${most.toLocaleString("en-US")} on that at the moment.`,
            );
          }

          /*
           * Asked, paid, then placed. The table is asked first because it is
           * the cheap refusal, and placed last because by then nothing is left
           * to go wrong — which is what keeps a chip on the cloth and the
           * chips that paid for it from ever disagreeing.
           */
          table.check(seatId, spot.id, chips);
          if (!(await stake(table, seat, chips, deps))) {
            throw new TableError(
              table.forFun ? "That is more than your purse." : "You do not have the chips for that.",
            );
          }
          table.place(seatId, spot.id, chips);
          return;
        }

        /*
         * Taking a chip back pays it out of the bank, which is the same
         * movement as a win and has to be, or a player could fill the bank by
         * placing and unplacing all evening.
         */
        case "take": {
          const spot = spotAt(move.spotId ?? "");
          if (spot === null) {
            throw new TableError("There is no such bet on this table.");
          }
          const off = table.take(seatId, spot.id, move.chips ?? 0);
          await pay(table, seat, off, deps);
          return;
        }

        case "undo":
        case "clear": {
          const before = table.staked(seatId);
          if (move.type === "undo") {
            table.undo(seatId);
          } else {
            table.clear(seatId);
          }
          const backOff = before - table.staked(seatId);
          await pay(table, seat, backOff, deps);
          return;
        }

        case "repeat": {
          const want = table.lastRound(seatId);
          for (const one of want) {
            const spot = spotAt(one.spotId);
            if (spot === null) {
              continue;
            }
            const most = headroom(await base(table), toBets(table.placed), spot);
            if (one.chips > most) {
              continue;
            }
            try {
              table.check(seatId, one.spotId, one.chips);
            } catch {
              // The window shut partway through. Whatever is down, stays down.
              return;
            }
            if (!(await stake(table, seat, one.chips, deps))) {
              return;
            }
            table.place(seatId, one.spotId, one.chips);
          }
          return;
        }

        default:
          throw new TableError("That is not a move at this table.");
      }
    },

    /**
     * Reads what the store's bank holds, so the view can show a cap.
     *
     * Not a payout — a seat that leaves this table is owed nothing, because
     * its chips went into the bank as they landed. What this hook uniquely
     * offers is that it runs on every broadcast, and what the bank holds is a
     * question for the store, which a view cannot ask because building one is
     * synchronous.
     *
     * A for-fun table never needs this: its bank is on the table and its
     * figure is exact from the moment it exists. Which is the good half of
     * doing it this way — the number can only ever be stale where staleness
     * costs a greyed-out spot on a table nobody is sitting at yet.
     */
    async payOut(table) {
      if (!table.forFun) {
        table.housed = await holds(table);
      }
    },

    isSettled(table) {
      return table.phase === "settled";
    },

    /**
     * Pays what the wheel owes.
     *
     * Every stake is already in the bank, so this only ever moves winnings
     * out. The bank cannot refuse: the cap on every chip was worked out
     * against the worst pocket on this exact cloth, so whatever the ball did,
     * what is owed now was covered before the ball was released. It is checked
     * anyway, because the alternative to checking is a bank that goes negative
     * in silence.
     */
    async settle(table, deps) {
      if (table.paid === null || table.pocket === null) {
        return;
      }
      for (const [seatId, paid] of table.paid) {
        const seat = table.seats.find((one) => one.id === seatId);
        if (seat === undefined) {
          continue;
        }
        /*
         * Play money is paid but never recorded. A for-fun table touches no
         * account, so a win there is not a win anybody's profile should claim
         * — and a guest has no account to write one on either way.
         */
        if (table.forFun || seat.userId === null) {
          await pay(table, seat, paid.back, deps);
          continue;
        }
        await pay(table, seat, paid.back, deps);
        await deps.record(seat.userId, {
          shared: {
            games: 1,
            wins: paid.back > paid.staked ? 1 : 0,
            chipsWon: paid.back - paid.staked,
            chipsStaked: paid.staked,
          },
          game: ROULETTE.id,
          add: { spins: 1 },
        });
      }
    },

    /** Who came out of the spin ahead, which is not the same as who was paid. */
    winners(table) {
      if (table.paid === null) {
        return [];
      }
      return [...table.paid.entries()]
        .filter(([, paid]) => paid.back > paid.staked)
        .map(([seatId]) => seatId);
    },

    /**
     * The table's own clock, which is the whole engine here.
     *
     * Three waits going round: the felt is open until a deadline, the ball is
     * in the air for a fixed moment, and a finished spin sits where it is long
     * enough to be read. Nobody has a turn, so unlike the card tables there is
     * never a wait on a person — which is why this game has no `clock` and no
     * `timeout` at all.
     */
    pause(table) {
      if (table.deadline === null) {
        return null;
      }
      const left = () => Math.max(0, (table.deadline ?? 0) - Date.now());
      switch (table.phase) {
        case "betting":
          return { key: "betting", ms: left(), run: () => table.closeBetting() };
        case "spinning":
          return { key: "spinning", ms: Math.min(left(), spinMs), run: () => table.land() };
        case "settled":
          return { key: "settled", ms: Math.min(left(), settleMs), run: () => table.beginBetting() };
      }
    },

    /**
     * What a seated bot wants to do next.
     *
     * Only while the felt is open, and only a chip at a time — a bot that put
     * its whole evening down at once would bury the cloth before anybody else
     * had looked at it.
     */
    botMove(table): BotMove | null {
      if (table.phase !== "betting" || table.lastCall) {
        return null;
      }
      for (const seat of table.seats) {
        if (!seat.isBot || seat.waiting) {
          continue;
        }
        const bet = botBet(seat.skill ?? "normal", table.pilesFor(seat.id), table.purseFor(seat.id));
        if (bet === null) {
          continue;
        }
        return {
          seatId: seat.id,
          delayMs: thinkingTime(),
          play: () => {
            try {
              table.place(seat.id, bet.spotId, bet.chips);
            } catch {
              // The window shut while it was thinking. Nothing to do.
            }
          },
        };
      }
      return null;
    },
  };
}
