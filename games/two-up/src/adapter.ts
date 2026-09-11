import type { BotMove, GameAdapter, GameDeps } from "@backroom/core";
import { seatLimit, TableError } from "@backroom/core";
import { headroom, type BetOn, MIN_CHIP, staked } from "./bank.js";
import { toBets } from "./bets.js";
import { TWO_UP } from "./listing.js";
import { FLIGHT_MS, KIP_MS, READ_MS, SETTLE_MS, Table, type School, WINDOWS } from "./table.js";

/** What a table needs of the chips everybody before it has staked. */
export interface Bank {
  holds(): Promise<number>;
  add(amount: number): Promise<void>;
  /** Pays out, or returns false rather than overdrawing. */
  take(amount: number): Promise<boolean>;
}

/** A message naming a fourth side cannot be built; this only rules out nonsense off the wire. */
function betOn(value: unknown): value is BetOn {
  return value === "heads" || value === "tails" || value === "fiveOdds";
}

/**
 * What the room does with a two-up table, in either of the two games it is.
 *
 * Modelled on `games/roulette/src/adapter.ts`, and the `holds` / `base` /
 * `stake` / `pay` helpers below are that file's almost unchanged — the same
 * bank, the same "ask cheaply, pay, then commit" order. What is new is that
 * the traditional school has no bank at all: `stake` and `pay` both branch on
 * `table.school` as well as on `table.forFun`, and for a ring the bank branch
 * is simply skipped. Every chip a ring moves came off one account and goes
 * straight to another, which is the whole of what "a ring has no bank and
 * must not have one" means in code.
 *
 * `random` defaults to `Math.random` only so a test need not pass one. The
 * server always hands this adapter its cryptographic source; a machine that
 * read its own coins back out of `Math.random` would be handing an attacker
 * exactly the run of observations needed to predict the next one, which is
 * the attack CLAUDE.md's clause about a cryptographic source exists to close.
 * The default here is a convenience for tests that do not care, not a claim
 * that `Math.random` is fit to toss a coin anybody is staking chips on.
 */
export function twoUpAdapter(
  options: {
    random?: () => number;
    /** How long the felt is open for bets, or for a centre. */
    window?: number;
    /** How long the coins are in the air. */
    flightMs?: number;
    /** How long a landed throw sits there being read. */
    readMs?: number;
    /** How long a finished round stays up before the next one opens. */
    settleMs?: number;
    /** How long the spinner has to press the kip before the boxer throws for them. */
    kipMs?: number;
    /**
     * The bank the casino school pays from.
     *
     * Never consulted by the traditional school, whatever it holds: a ring's
     * chips move between the people at the table and nowhere else.
     */
    bank?: Bank;
  } = {},
): GameAdapter<Table> {
  const bank = options.bank ?? null;
  const random = options.random ?? Math.random;
  const flightMs = options.flightMs ?? FLIGHT_MS;
  const readMs = options.readMs ?? READ_MS;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const kipMs = options.kipMs ?? KIP_MS;

  /*
   * Where a table's money actually lives.
   *
   * A for-fun table's purse and bank live on the table and are gone when it
   * closes; a chips table's live in the store and belong to real people. A
   * signed-in player sitting at a for-fun table must spend the former, and a
   * branch that got this wrong would quietly spend the latter — a real
   * balance, really gone.
   */

  const holds = async (table: Table): Promise<number> => {
    if (table.forFun) {
      return table.funBank;
    }
    return bank === null ? Number.MAX_SAFE_INTEGER : bank.holds();
  };

  /**
   * What the bank holds, not counting this round's chips.
   *
   * Casino school only — a ring never reasons about a bank at all, so nothing
   * here is asked to work for it. Chips go into the bank as they land, so what
   * it holds mid-window already includes them, and `headroom` subtracts the
   * stakes itself — handing it the inflated figure would let the cloth vouch
   * for itself.
   */
  const base = async (table: Table): Promise<number> =>
    (await holds(table)) - staked(toBets(table.placed));

  /**
   * Chips off the player, and into the bank if this is the casino school.
   *
   * The same call whichever school is staking, because forFun is the same
   * mechanism in both: a table's own purse, gone when the table closes. Only
   * the real-money path forks, and it forks on `table.school` rather than on
   * which action asked — `place`, `centre` and `cover` all end up here, and
   * only the casino school's chip is ever banked.
   */
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
    if (table.school === "casino") {
      await bank?.add(chips);
    }
    return true;
  };

  /** Chips out of the bank, if this is the casino school, and back to the player. */
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
     * Only if the bank actually holds it, and only ever asked in the casino
     * school. The cap on every chip there was worked out against the worst
     * outcome on this exact cloth, so this cannot refuse — which is exactly
     * why it is checked: the alternative is a bank going negative in silence.
     * A ring never reaches this branch at all; every chip it hands back came
     * off an account in this same round; there is nothing here to check it
     * against.
     */
    if (table.school === "casino" && bank !== null && !(await bank.take(chips))) {
      return;
    }
    if (seat.userId !== null) {
      await deps.give(seat.userId, chips);
    }
  };

  return {
    listing: TWO_UP,

    create(code, made) {
      const window = WINDOWS.includes(made?.["window"] as (typeof WINDOWS)[number])
        ? (made?.["window"] as number)
        : (options.window ?? WINDOWS[1]);
      // A table that will not open is a worse answer than one playing the
      // commoner game, so anything the host did not spell out gets "casino".
      const school: School = made?.["ruleset"] === "school" ? "school" : "casino";
      const table = new Table(code, seatLimit(made?.["maxSeats"], TWO_UP.maxSeats), {
        school,
        window,
      });
      table.forFun = made?.["forFun"] === true;
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; on?: unknown; chips?: number };
      const seat = table.seats.find((one) => one.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }

      /*
       * Common to both schools, and the one action that reaches the table's
       * own clock at all. `throwCoins` checks the seat holds the kip;
       * `boxerThrows` checks nothing because the boxer is the table itself —
       * which is exactly why a client action must never be routed there.
       */
      if (move.type === "throw") {
        table.throwCoins(seatId, random);
        return;
      }

      if (table.school === "casino") {
        switch (move.type) {
          case "place": {
            if (!betOn(move.on)) {
              throw new TableError("There is no such bet on this table.");
            }
            const on = move.on;
            const chips = move.chips ?? 0;

            /*
             * What this side can still take, worked out across the whole
             * cloth. One throw settles everybody, so the table's exposure is
             * a single shared number and a cap that ignored the other seats
             * would be a promise made in front of people it did not count.
             */
            const most = headroom(await base(table), toBets(table.placed), on);
            if (chips > most) {
              throw new TableError(
                most === 0
                  ? "The bank cannot cover any more on that."
                  : `The bank covers ${most.toLocaleString("en-US")} on that at the moment.`,
              );
            }

            /*
             * Asked, paid, then placed. The table is asked first because it
             * is the cheap refusal, and placed last because by then nothing
             * is left to go wrong — which is what keeps a chip on the cloth
             * and the chips that paid for it from ever disagreeing.
             */
            table.check(seatId, on, chips);
            if (!(await stake(table, seat, chips, deps))) {
              throw new TableError(
                table.forFun
                  ? "That is more than your purse."
                  : "You do not have the chips for that.",
              );
            }
            table.place(seatId, on, chips);
            return;
          }

          /*
           * Taking a chip back pays it out of the bank, the same movement as
           * a win — otherwise a player could fill the bank by placing and
           * unplacing all evening.
           */
          case "take": {
            if (!betOn(move.on)) {
              throw new TableError("There is no such bet on this table.");
            }
            const off = table.take(seatId, move.on, move.chips ?? 0);
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
              const most = headroom(await base(table), toBets(table.placed), one.on);
              if (one.chips > most) {
                continue;
              }
              try {
                table.check(seatId, one.on, one.chips);
              } catch {
                // The window shut partway through. Whatever is down, stays down.
                return;
              }
              if (!(await stake(table, seat, one.chips, deps))) {
                return;
              }
              table.place(seatId, one.on, one.chips);
            }
            return;
          }

          default:
            throw new TableError("That is not a move at this table.");
        }
      }

      // The traditional school: a centre, and the ring covering it.
      switch (move.type) {
        case "centre":
        case "cover": {
          const chips = move.chips ?? 0;
          /*
           * The one check that has to happen before any money moves rather
           * than after: `table.setCentre`/`table.cover` refuse a bad amount
           * too, but only once the chips are already staked, and this table
           * has no side-effect-free `check` to ask first the way the casino
           * school does. A non-integer or negative figure handed straight to
           * a store that merely compares balances is not refused, it is
           * exploited — so the shape of the number is settled here, before
           * a single chip leaves an account.
           */
          if (!Number.isInteger(chips) || chips < MIN_CHIP) {
            throw new TableError(`The smallest chip here is ${MIN_CHIP}.`);
          }
          if (!(await stake(table, seat, chips, deps))) {
            throw new TableError(
              table.forFun
                ? "That is more than your purse."
                : "You do not have the chips for that.",
            );
          }
          /*
           * Every other reason the table might refuse — the window shut, this
           * is not the spinner, the cover overshoots — comes after the chips
           * have already moved, because there is nothing left in this table
           * that can raise them once the amount is a sane positive integer.
           * If the table still says no, the chips go straight back: the
           * account and the cloth can never end this action disagreeing.
           */
          try {
            if (move.type === "centre") {
              table.setCentre(seatId, chips);
            } else {
              table.cover(seatId, chips);
            }
          } catch (error) {
            await pay(table, seat, chips, deps);
            throw error;
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
     * Casino chips tables only. A ring never banks anything at all — every
     * chip it moves goes straight from one account to another — so there is
     * nothing here for it to refresh, and a for-fun table's bank is exact
     * from the moment it exists.
     */
    async payOut(table) {
      if (!table.forFun && table.school === "casino") {
        table.housed = await holds(table);
      }
    },

    isSettled(table) {
      return table.phase === "settled";
    },

    /**
     * Pays what the coins owe.
     *
     * Two entirely different movements behind one verb, which is why the branch
     * is the first thing here. A casino round pays out of the bank, and the
     * bank cannot refuse: every chip's cap was worked out against the worst
     * outcome on this exact cloth, so whatever the coins did was covered before
     * they left the kip. It is checked anyway, because the alternative to
     * checking is a bank going negative in silence.
     *
     * A ring has no bank and must not have one. Every chip being handed out
     * here came off somebody's account in this same round, so this only ever
     * gives — and `payouts` guarantees the sum of it equals the sum that was
     * staked, which is the whole of what makes this school honest.
     */
    async settle(table, deps) {
      if (table.school === "school") {
        const owing = table.owing;
        if (owing === null) {
          return;
        }
        table.owing = null;
        for (const [seatId, chips] of owing) {
          const seat = table.seats.find((one) => one.id === seatId);
          if (seat === undefined || chips <= 0) {
            continue;
          }
          await pay(table, seat, chips, deps);
          if (!table.forFun && seat.userId !== null) {
            const staked = table.stakedIn(seatId);
            await deps.record(seat.userId, {
              shared: { games: 1, wins: chips > staked ? 1 : 0, chipsWon: chips - staked },
              game: TWO_UP.id,
              add: { rounds: 1 },
            });
          }
        }
        return;
      }

      if (table.paid === null || table.called === null) {
        return;
      }
      for (const [seatId, paid] of table.paid) {
        const seat = table.seats.find((one) => one.id === seatId);
        if (seat === undefined) {
          continue;
        }
        await pay(table, seat, paid.back, deps);
        /*
         * Play money is paid but never recorded. A for-fun table touches no
         * account, so a win there is not a win anybody's profile should claim —
         * and a guest has no account to write one on either way.
         */
        if (table.forFun || seat.userId === null) {
          continue;
        }
        await deps.record(seat.userId, {
          shared: {
            games: 1,
            wins: paid.back > paid.staked ? 1 : 0,
            chipsWon: paid.back - paid.staked,
          },
          game: TWO_UP.id,
          add: { rounds: 1 },
        });
      }
    },

    /**
     * The table's own clock, which is the whole engine here.
     *
     * Longer than the wheel's because a round can be five throws rather than
     * one, and the key is what makes that safe. `spinning:3` and `spinning:4`
     * are different waits, and without the number in there the server would see
     * the fourth throw as the third's already scheduled and never fire it —
     * which is a table that stops dead on an odds.
     *
     * A holding ring is not timing anything, so it schedules nothing. That is
     * what "holds with the felt untouched" looks like from here: no clock, no
     * sweep, nothing to expire.
     */
    pause(table) {
      if (table.deadline === null || table.holding) {
        return null;
      }
      const left = () => Math.max(0, (table.deadline ?? 0) - Date.now());
      const at = table.throws.length;
      switch (table.phase) {
        case "betting":
          return { key: "betting", ms: left(), run: () => table.closeBetting() };
        case "centre":
          return { key: "centre", ms: left(), run: () => table.closeCentre() };
        case "covering":
          return { key: "covering", ms: left(), run: () => table.closeCovering() };
        case "kip":
          return {
            key: `kip:${at}`,
            ms: Math.min(left(), kipMs),
            run: () => table.boxerThrows(random),
          };
        case "spinning":
          return {
            key: `spinning:${at}`,
            ms: Math.min(left(), flightMs),
            run: () => table.land(),
          };
        case "reading":
          return {
            key: `reading:${at}`,
            ms: Math.min(left(), readMs),
            run: () => table.read(random),
          };
        case "settled":
          return { key: "settled", ms: Math.min(left(), settleMs), run: () => table.beginRound() };
      }
    },

    /**
     * What a seated bot wants to do next.
     *
     * A stub: this game has no bots yet, and a table playing for chips must
     * never get one whatever arrives later, which is the check that stays.
     */
    botMove(table): BotMove | null {
      if (!table.forFun) {
        return null;
      }
      return null;
    },
  };
}
