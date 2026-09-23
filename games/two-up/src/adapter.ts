import type { BotMove, GameAdapter, GameDeps } from "@backroom/core";
import { ledgerOf, seatLimit, TableError } from "@backroom/core";
import { botBet, thinkingTime } from "./bot.js";
import { type Bet, headroom, type BetOn, MIN_CHIP, owed, staked } from "./bank.js";
import { toBets } from "./bets.js";
import { uncovered } from "./centre.js";
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
 * Whether a bot may act on this table right now.
 *
 * Roulette's one betting window lets its loop take the first bot it finds; a
 * ring cannot, because only the spinner may set a centre and the spinner may
 * never cover their own. Offering an ineligible bot is silent — the table's
 * refusal is swallowed by `play()` — so without this gate the loop below picks
 * the same stuck seat every scheduling cycle and a bot that could actually act
 * is never reached.
 */
function mayAct(table: Table, seatId: string): boolean {
  if (table.school === "casino") {
    return table.phase === "betting";
  }
  if (table.phase === "centre") {
    return seatId === table.spinnerId;
  }
  if (table.phase === "covering") {
    return (
      table.centre !== null &&
      seatId !== table.centre.seatId &&
      uncovered(table.centre, table.covers) >= MIN_CHIP
    );
  }
  return false;
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
   * The book every casino table paid from this bank keeps together.
   *
   * Every casino school in the building is paid from one bank, so a cap worked
   * out against this table's cloth alone reads every other table's chips as
   * headroom — chips those tables' winners are already owed. See `BankLedger`
   * for the whole of why.
   */
  const ledger = bank === null ? null : ledgerOf(bank);

  /** Whether this table's chips are the bank's, and so in the book. A ring's never are. */
  const banked = (table: Table): boolean =>
    ledger !== null && !table.forFun && table.school === "casino";

  /** Rounds that have been paid, so a settled cloth stops holding the bank's chips. */
  const paidOut = new WeakSet<object>();

  /**
   * A round handed to `settle` and still waiting its turn in the queue.
   *
   * Counted apart from the table, because the table does not wait for it: a
   * cloth swept for the next round no longer says what the last one is owed.
   */
  const unpaid = new WeakMap<Table, { round: object; back: number }>();

  /** What a void has taken off the escrow and not yet paid out of the bank. */
  const refunding = new WeakMap<Table, number>();

  const backOf = (round: ReadonlyMap<string, { back: number }>): number => {
    let back = 0;
    for (const one of round.values()) {
      back += one.back;
    }
    return back;
  };

  /**
   * The most this table could still take out of the bank, stakes back included.
   *
   * The cloth's worst outcome until the coins are called, what they called
   * until that is paid, and nothing after.
   */
  const owing = (table: Table): number => {
    /*
     * A called-off table owes only the refunds its void has yet to pay. Those
     * chips are still in the bank until the void's turn in the queue comes,
     * and another table reading them as free would take stakes against chips
     * about to leave. After that nothing — an act queued behind the void would
     * otherwise put its reservation back on the way out of `serially`.
     */
    if (table.escrow.closed) {
      return refunding.get(table) ?? 0;
    }
    const waiting = unpaid.get(table);
    let total = waiting?.back ?? 0;
    if (table.paid === null) {
      total += owed(toBets(table.placed));
    } else if (table.paid !== waiting?.round && !paidOut.has(table.paid)) {
      total += backOf(table.paid);
    }
    return total;
  };

  /**
   * Runs something that moves this table's chips in the bank's own queue, and
   * tells the book what the table owes once it has.
   *
   * Anything else skips the queue: a for-fun table's bank is a field on the
   * table, and a ring has no bank to promise anybody anything from.
   */
  const serially = async <T>(table: Table, work: () => Promise<T>): Promise<T> => {
    if (ledger === null || !banked(table)) {
      return work();
    }
    return ledger.serially(async () => {
      try {
        return await work();
      } finally {
        ledger.owes(table, () => owing(table));
      }
    });
  };

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
   *
   * Nor counting what every other casino table on this bank could owe: their
   * chips are in there too, and are not this table's to promise. Only a fact
   * inside `serially`, where nothing else can move the bank between reading it
   * and a chip landing.
   */
  const base = async (table: Table): Promise<number> => {
    const held = await holds(table);
    const elsewhere = ledger !== null && banked(table) ? ledger.owedElsewhere(table) : 0;
    return held - staked(toBets(table.placed)) - elsewhere;
  };

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

  /**
   * A bot paying for its own chip.
   *
   * Synchronous, and it can be, which is the whole reason it is not `stake`
   * above: `play()` cannot await, and on this path there is no account and no
   * store to await. A bot only ever plays at a for-fun table, where the purse
   * and the bank are both fields on the table.
   *
   * Without it the felt carries a chip nobody paid for, and settlement then
   * pays the bot as though it had — the same conservation break the rest of
   * this package is built to rule out, wearing play money as a disguise.
   */
  const stakeFun = (table: Table, seatId: string, chips: number): boolean => {
    if (table.purseFor(seatId) < chips) {
      return false;
    }
    table.movePurse(seatId, -chips);
    table.funBank += chips;
    return true;
  };

  /** The same movement backwards, for a chip the table then refused. */
  const refundFun = (table: Table, seatId: string, chips: number): void => {
    table.funBank -= chips;
    table.movePurse(seatId, chips);
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
      /*
       * Loudly, because a refusal now means something outside the book moved
       * the bank: another process, or a hand on the database. A winner left
       * unpaid with nothing in the log is how this hid the first time.
       */
      console.error(
        `two-up ${table.code}: the bank refused ${chips} owed to ${seat.userId ?? seat.id}`,
      );
      return;
    }
    if (seat.userId !== null) {
      await deps.give(seat.userId, chips);
    }
  };

  /**
   * Chips off the cloth, unless the bets left behind would lose their cover.
   *
   * A chip coming off comes out of the bank, and what it leaves does not get
   * cheaper for it: heads went down against the bank, tails was then allowed
   * to lean on heads, and taking heads back leaves tails owed more than the
   * bank holds. So it is refused — but only when it makes the shortfall worse,
   * so a bank drained from outside never traps anybody's chips on a cloth.
   *
   * Returns what came off, or null with the cloth put back. The cloth is read
   * only once the bank has been, so no await sits between looking at the
   * chips, lifting them and putting them back: a cloth copied before the await
   * could be restored over whatever changed during it.
   *
   * One implementation for a take-back and for a seat that left, because the
   * cover a chip gives does not depend on why it is coming off.
   */
  const lift = async (table: Table, move: () => void): Promise<number | null> => {
    const floor = await base(table);
    const before = [...table.placed];
    move();
    const off = staked(toBets(before)) - staked(toBets(table.placed));
    if (banked(table)) {
      const short = (bets: readonly Bet[]) => owed(bets) - staked(bets) - floor;
      if (short(toBets(table.placed)) > Math.max(0, short(toBets(before)))) {
        // Nothing has been released from the escrow yet, so putting the
        // cloth back is all it takes to leave the two in step.
        table.placed = before;
        return null;
      }
    }
    return off;
  };

  /** Chips that came off the cloth, back to the account that put them there. */
  const payBack = async (
    table: Table,
    seat: { id: string; userId: string | null },
    off: number,
    deps: GameDeps,
  ): Promise<void> => {
    if (table.forFun || seat.userId === null) {
      await pay(table, seat, off, deps);
      return;
    }
    /*
     * What the escrow actually lets go of, never the nominal drop: a void
     * ahead of this in the bank's queue may already have handed these chips
     * back, and paying them again would pay them twice.
     */
    const back = table.escrow.release(seat.userId, off);
    await pay(table, seat, back, deps);
  };

  /** A seat's own chips back off the cloth, or a refusal if another bet leans on them. */
  const giveBack = async (
    table: Table,
    seat: { id: string; userId: string | null },
    move: () => void,
    deps: GameDeps,
  ): Promise<void> => {
    const off = await lift(table, move);
    if (off === null) {
      throw new TableError("That chip is covering another bet. It stays for this round.");
    }
    await payBack(table, seat, off, deps);
  };

  /**
   * Whose account a payout goes to, seated or not.
   *
   * A decided payout does not leave with the seat. Called before any await,
   * because `beginRound` prunes the accounts of departed seats on its own
   * clock, and a lookup made after one could find nobody.
   */
  const payee = (table: Table, seatId: string): { id: string; userId: string | null } => {
    const here = table.seats.find((one) => one.id === seatId);
    return { id: seatId, userId: here?.userId ?? table.accountOf(seatId) };
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
      const move = action as { type?: string; on?: unknown; chips?: unknown };
      /*
       * A number off the wire is not a number until it has been asked. The
       * socket envelope validates the action's `type` and passes every other
       * field through as the client sent it, so this is where a chip count
       * becomes one. Anything else is nothing: a `NaN` here lands on the
       * cloth, and from there every `staked`, `owed` and `headroom` figure on
       * it, the bank's own total, and the store.
       */
      const chipsOf = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
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
        await serially(table, async () => {
          switch (move.type) {
            case "place": {
              if (!betOn(move.on)) {
                throw new TableError("There is no such bet on this table.");
              }
              const on = move.on;
              const chips = chipsOf(move.chips);

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
              /*
               * And straight back out if the cloth refuses it now. Taking the
               * chips is an await, and the table does not stand still for it:
               * last call can arrive, the window can shut on its own clock, the
               * seat can go, the table can be called off. The chips are in the
               * bank by then, so they come out the way a take-back does — in
               * full, because a refused place never reached the escrow.
               */
              try {
                table.place(seatId, on, chips);
              } catch (error) {
                await pay(table, seat, chips, deps);
                throw error;
              }
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
              const on = move.on;
              await giveBack(table, seat, () => table.take(seatId, on, chipsOf(move.chips)), deps);
              return;
            }

            case "undo":
              await giveBack(table, seat, () => table.undo(seatId), deps);
              return;

            case "clear":
              await giveBack(table, seat, () => table.clear(seatId), deps);
              return;

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
                // The same await as a single chip, and the same way back out.
                try {
                  table.place(seatId, one.on, one.chips);
                } catch {
                  await pay(table, seat, one.chips, deps);
                  return;
                }
              }
              return;
            }

            default:
              throw new TableError("That is not a move at this table.");
          }
        });
        return;
      }

      // The traditional school: a centre, and the ring covering it.
      switch (move.type) {
        case "centre":
        case "cover": {
          const chips = chipsOf(move.chips);
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
            // In full: the table holds only after its last check, so a refusal held nothing.
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
     * Hands back chips left down by somebody who stood up while bets were
     * open, and reads what the store's bank holds so the view can show a cap.
     *
     * Both belong here because this hook runs on every broadcast. Leaving is
     * synchronous, so the table can only note who left; whether their chips
     * can come off, and what the bank holds, are questions for the store,
     * which neither leaving nor building a view can await.
     *
     * The cap is casino chips tables only. A ring never banks anything at all
     * — every chip it moves goes straight from one account to another — so
     * there is nothing here for it to refresh, and a for-fun table's bank is
     * exact from the moment it exists.
     *
     * Less what the other casino tables on this bank could owe, so the felt
     * greys out what the refusal would. Showing only; `place` asks again.
     */
    async payOut(table, deps) {
      /*
       * A ring's stakes, queued when its last player left. Taken off the queue
       * before the first await, so a call on every broadcast pays each once;
       * a ring banks nothing, so they go straight back. A void that closed the
       * escrow first took the queue with it, and this finds nothing.
       */
      for (const one of table.escrow.takeDue()) {
        await pay(table, { id: one.userId, userId: one.userId }, one.chips, deps);
      }
      if (table.leaving.size > 0) {
        await serially(table, async () => {
          /*
           * Round again while anybody's chips came off. A refused leaver stays
           * in the set, because the bet leaning on them can go too — and if it
           * was the last seat, nothing will ever spin to settle what is left.
           */
          let moved = true;
          while (moved) {
            moved = false;
            for (const seatId of [...table.leaving]) {
              const seat = payee(table, seatId);
              let off: number | null;
              try {
                off = await lift(table, () => {
                  // Asked again after the bank read: a join or a shut window may have taken them out.
                  if (table.leaving.has(seatId)) {
                    table.clear(seatId);
                  }
                });
              } catch (error) {
                // The window shut while the bank was read, so the chips ride.
                if (error instanceof TableError) {
                  continue;
                }
                throw error;
              }
              // Refused: the chips stay down, and the seat stays to be asked again.
              if (off === null) {
                continue;
              }
              // Out of the set before the payment awaits, so nothing lifts it twice.
              table.leaving.delete(seatId);
              if (off > 0) {
                moved = true;
                await payBack(table, seat, off, deps);
              }
            }
          }
        });
      }
      if (!table.forFun && table.school === "casino") {
        const elsewhere = ledger?.owedElsewhere(table) ?? 0;
        table.housed = (await holds(table)) - elsewhere;
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
        /*
         * Everybody who staked into this ring, with their account and stake,
         * read now — before the first payment yields.
         *
         * Not from `owing`: that names only the seats the coins hand chips
         * back to, so a loser is not in it, and a record written only from it
         * gave every ring a winner and never a loser — a W–L that climbs on one
         * side forever. And not read later: the sweep clears the centre and the
         * covers the moment it runs, on the table's own clock, so a stake read
         * after an await can come back as nothing.
         */
        const players = new Map<string, { userId: string | null; staked: number }>();
        for (const seatId of [table.centre?.seatId, ...table.covers.map((one) => one.seatId)]) {
          if (seatId === undefined || players.has(seatId)) {
            continue;
          }
          players.set(seatId, {
            userId: payee(table, seatId).userId,
            staked: table.stakedIn(seatId),
          });
        }
        const payees = [...owing].map(([seatId, chips]) => ({ seat: payee(table, seatId), chips }));
        for (const { seat, chips } of payees) {
          if (chips <= 0) {
            continue;
          }
          /*
           * Paid whether or not they are still standing at the table, to the
           * account resolved above before anything was awaited.
           *
           * A seat can leave in the middle of a round and what the coins
           * decided it was owed does not leave with it. Skipping a departed
           * seat looks like tidiness and is destruction: in a ring there is no
           * bank to absorb an unpaid win, so those chips simply stop existing,
           * which is the mirror image of minting them.
           *
           * This is a deliberate divergence from the wheel, which pays nobody
           * who has stood up. Its argument is about the stake — already in the
           * bank, so nothing is owed — and that argument does not reach a
           * payout the coins have already decided, nor a school with no bank
           * behind it at all.
           */
          await pay(table, seat, chips, deps);
        }

        /* Play money is paid but never recorded, for the same reason as the casino. */
        if (table.forFun) {
          return;
        }
        for (const [seatId, { userId, staked }] of players) {
          if (userId === null) {
            continue;
          }
          const back = owing.get(seatId) ?? 0;
          await deps.record(userId, {
            shared: {
              rounds: 1,
              roundsWon: back > staked ? 1 : 0,
              chipsWon: back - staked,
              chipsStaked: staked,
            },
            game: TWO_UP.id,
            add: { rounds: 1 },
          });
        }
        return;
      }

      /*
       * Read before joining the bank's queue, not after: the table sweeps its
       * cloth on its own clock, and a settle that looked for the result once
       * its turn came could find nothing there to pay.
       */
      const round = table.paid;
      if (round === null || table.called === null) {
        return;
      }
      /* Same rule as the ring above: resolved now, and paid seated or not. */
      const payees = [...round].map(([seatId, paid]) => ({ seat: payee(table, seatId), paid }));
      if (banked(table)) {
        unpaid.set(table, { round, back: backOf(round) });
      }
      await serially(table, async () => {
        for (const { seat, paid } of payees) {
          const { userId } = seat;
          await pay(table, seat, paid.back, deps);
          /*
           * Play money is paid but never recorded. A for-fun table touches no
           * account, so a win there is not a win anybody's profile should claim —
           * and a guest has no account to write one on either way.
           */
          if (table.forFun || userId === null) {
            continue;
          }
          await deps.record(userId, {
            shared: {
              rounds: 1,
              roundsWon: paid.back > paid.staked ? 1 : 0,
              chipsWon: paid.back - paid.staked,
              chipsStaked: paid.staked,
            },
            game: TWO_UP.id,
            add: { rounds: 1 },
          });
        }
        paidOut.add(round);
        unpaid.delete(table);
      });
    },

    /**
     * Calls the table off: every chip still staked, back to whoever put it
     * there, and this table's claim on the bank released.
     *
     * One path for both schools, because `pay` already knows a ring has no
     * bank: a casino chip comes out of the bank and a ring's goes straight back
     * to its account.
     */
    async void(table, deps) {
      const owed = table.escrow.close();
      refunding.set(table, owed.reduce((sum, one) => sum + one.chips, 0));
      await serially(table, async () => {
        try {
          for (const one of owed) {
            await pay(table, { id: one.userId, userId: one.userId }, one.chips, deps);
          }
        } finally {
          // Inside the work, so `serially` reads the table as owing nothing on its way out.
          refunding.delete(table);
        }
      });
      ledger?.release(table);
      return owed;
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
     * Bots exist to make a for-fun table worth sitting at on your own. They
     * are dealt in at play-money tables and refused at every other kind, which
     * is what the `forFun` check below enforces: a chips table may never get a
     * bot, however one arrives later, because a bot at a table playing for
     * chips would be a button that mints.
     *
     * A table playing for chips has no need for distraction, so both schools
     * only move on their own clocks — nobody presses start, and nobody moves on
     * anybody else's button. Bots are noise at a table like that, which is why
     * they are a for-fun feature entirely.
     */
    botMove(table): BotMove | null {
      if (!table.forFun) {
        return null;
      }

      /*
       * The casino school bets during "betting"; the traditional school has a
       * centre window and a covering window, neither of which takes more chips
       * in the last 5 seconds of its own timer.
       */
      const canAct =
        !table.lastCall &&
        ((table.school === "casino" && table.phase === "betting") ||
          (table.school === "school" && (table.phase === "centre" || table.phase === "covering")));

      if (!canAct) {
        return null;
      }

      for (const seat of table.seats) {
        if (!seat.isBot || seat.waiting || !mayAct(table, seat.id)) {
          continue;
        }

        /*
         * Count existing piles: a pile is one entry in placed for this seat.
         * For the traditional school, count entries in covers instead.
         */
        let pileCount = 0;
        if (table.school === "casino") {
          pileCount = table.placed.filter((one) => one.seatId === seat.id).length;
        } else {
          pileCount = table.covers.filter((one) => one.seatId === seat.id).length;
          /*
           * If this bot is the spinner and no centre is set, count that as an
           * entry too so it doesn't spam centres.
           */
          if (table.centre?.seatId === seat.id) {
            pileCount += 1;
          }
        }

        const purse = table.purseFor(seat.id);
        const bet = botBet(seat.skill ?? "normal", pileCount, purse);
        if (bet === null) {
          continue;
        }

        /*
         * A cover offered past what is left would only be refused by the
         * table, so it is capped here instead — the difference between a bot
         * that stalls the window bidding for chips it cannot place and one
         * that quietly takes what is left.
         */
        const room =
          table.school === "school" && table.phase === "covering" && table.centre !== null
            ? uncovered(table.centre, table.covers)
            : Number.MAX_SAFE_INTEGER;
        const chips = Math.min(bet.chips, room);
        if (chips < MIN_CHIP) {
          continue;
        }

        return {
          seatId: seat.id,
          delayMs: thinkingTime(),
          play: () => {
            if (!stakeFun(table, seat.id, chips)) {
              return;
            }
            try {
              if (table.school === "casino") {
                table.place(seat.id, bet.on, chips);
              } else if (table.phase === "centre") {
                table.setCentre(seat.id, chips);
              } else {
                table.cover(seat.id, chips);
              }
            } catch {
              // The window shut while it was thinking. Give the chips back.
              refundFun(table, seat.id, chips);
            }
          },
        };
      }
      return null;
    },
  };
}
