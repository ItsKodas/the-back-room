import type { BotMove, GameAdapter, GameDeps } from "@backroom/core";
import { ledgerOf, seatLimit, TableError } from "@backroom/core";
import { type Bet, headroom, owed, staked } from "./bank.js";
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
   * The book every table paid from this bank keeps together.
   *
   * Every roulette table in the building is paid from one bank, so a cap
   * worked out against this table's cloth alone reads every other table's
   * chips as headroom — chips those tables' winners are already owed. See
   * `BankLedger` for the whole of why.
   */
  const ledger = bank === null ? null : ledgerOf(bank);

  /** Whether this table's chips are the bank's, and so in the book. */
  const banked = (table: Table): boolean => ledger !== null && !table.forFun;

  /** Spins that have been paid, so a settled cloth stops holding the bank's chips. */
  const paidOut = new WeakSet<object>();

  /**
   * A spin handed to `settle` and still waiting its turn in the queue.
   *
   * Counted apart from the table, because the table does not wait for it: a
   * cloth swept for the next window no longer says what the last one is owed.
   */
  const unpaid = new WeakMap<Table, { spin: object; back: number }>();

  const backOf = (spin: ReadonlyMap<string, { back: number }>): number => {
    let back = 0;
    for (const one of spin.values()) {
      back += one.back;
    }
    return back;
  };

  /**
   * The most this table could still take out of the bank, stakes back included.
   *
   * The cloth's worst pocket until the ball lands, what the ball actually
   * decided until that is paid, and nothing after.
   */
  const owing = (table: Table): number => {
    const waiting = unpaid.get(table);
    let total = waiting?.back ?? 0;
    if (table.paid === null) {
      total += owed(toBets(table.placed));
    } else if (table.paid !== waiting?.spin && !paidOut.has(table.paid)) {
      total += backOf(table.paid);
    }
    return total;
  };

  /**
   * Runs something that moves this table's chips in the bank's own queue, and
   * tells the book what the table owes once it has.
   *
   * A for-fun table skips the queue: its bank is a field on the table, nobody
   * else's chips are in it, and it cannot promise anybody anything.
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
   *
   * Nor counting what every other table paid from this bank could owe. Their
   * chips are in there too, and they are not this table's to promise. Only
   * a fact inside `serially`, where nothing else can move the bank between
   * reading it and a chip landing.
   */
  const base = async (table: Table): Promise<number> => {
    const held = await holds(table);
    const elsewhere = ledger !== null && banked(table) ? ledger.owedElsewhere(table) : 0;
    return held - staked(toBets(table.placed)) - elsewhere;
  };

  /**
   * Chips back off the cloth, unless the bets left behind would lose their cover.
   *
   * A chip coming off comes out of the bank, and what it leaves does not get
   * cheaper for it: red went down against the bank, black was then allowed to
   * lean on red, and taking red back leaves black owed more than the bank
   * holds. So it is refused — but only when it makes the shortfall worse, so
   * a bank drained from outside never traps anybody's chips on a cloth.
   */
  const giveBack = async (
    table: Table,
    seat: { id: string; userId: string | null },
    lift: () => void,
    deps: GameDeps,
  ): Promise<void> => {
    const before = [...table.placed];
    const floor = await base(table);
    lift();
    const off = staked(toBets(before)) - staked(toBets(table.placed));
    if (banked(table)) {
      const short = (bets: readonly Bet[]) => owed(bets) - staked(bets) - floor;
      if (short(toBets(table.placed)) > Math.max(0, short(toBets(before)))) {
        table.placed = before;
        throw new TableError("That chip is covering another bet. It stays for this spin.");
      }
    }
    await pay(table, seat, off, deps);
  };

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

  /**
   * A bot paying for its own chip.
   *
   * Synchronous, which is the whole reason it is not `stake` above: `play()`
   * cannot await, and on this path there is nothing to await. A bot only ever
   * plays at a for-fun table, where the purse and the bank are both fields on
   * the table.
   *
   * Without it the cloth carries a chip nobody paid for, and settlement then
   * pays the bot out of the table's bank as though it had.
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
     * against the worst pocket on every cloth this bank pays, so this cannot
     * refuse — which is exactly why it is checked. The alternative is a bank
     * going negative in silence and a wheel that has quietly started minting.
     *
     * And loudly, because a refusal now means something outside the book
     * moved the bank: another process, or a hand on the database. A winner
     * left unpaid with nothing in the log is how this hid the first time.
     */
    if (bank !== null && !(await bank.take(chips))) {
      console.error(
        `roulette ${table.code}: the bank refused ${chips} owed to ${seat.userId ?? seat.id}`,
      );
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

      await serially(table, async () => {
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
            await giveBack(table, seat, () => table.take(seatId, spot.id, move.chips ?? 0), deps);
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
      });
    },

    /**
     * Hands back chips left on an open cloth by somebody who stood up, then
     * reads what the store's bank holds so the view can show a cap.
     *
     * A seat that leaves mid-window never saw the spin its chips were for, so
     * they come back — through `giveBack`, the same door a player's own "clear"
     * uses, because a refund out of the bank is a payout like any other and
     * must not uncover a bet somebody else placed against it. When it would,
     * the chips stay down and ride the spin, and `settle` pays them to their
     * owner. So does a window that shut before this got its turn in the queue.
     * Either way nothing is kept.
     *
     * Drained before the first await, which is what makes a call on every
     * broadcast exactly-once per seat.
     *
     * The bank figure: what the bank holds is a question for the store, which
     * a view cannot ask because building one is synchronous. A for-fun table
     * never needs it — its bank is on the table and exact from the moment it
     * exists. Less what the other tables on this bank could owe, so the felt
     * greys out the same spots the refusal would. Showing only; `place` asks
     * again.
     */
    async payOut(table, deps) {
      const leaving = table.leaving.splice(0);
      if (leaving.length > 0) {
        await serially(table, async () => {
          for (const seatId of leaving) {
            const owner = { id: seatId, userId: table.accountOf(seatId) };
            try {
              await giveBack(table, owner, () => table.clear(seatId), deps);
            } catch (error) {
              if (!(error instanceof TableError)) {
                throw error;
              }
            }
          }
        });
      }
      if (!table.forFun) {
        const elsewhere = ledger?.owedElsewhere(table) ?? 0;
        table.housed = (await holds(table)) - elsewhere;
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
     *
     * In the bank's queue, so that no other table reads the bank with this
     * spin's winnings paid out of it and still counted as owed, or the other
     * way round. The spin is read before joining the queue, not after: the
     * table sweeps its cloth on its own clock, and a settle that looked for
     * the result once its turn came could find nothing there to pay.
     */
    async settle(table, deps) {
      const spin = table.paid;
      if (spin === null || table.pocket === null) {
        return;
      }
      if (banked(table)) {
        unpaid.set(table, { spin, back: backOf(spin) });
      }
      /*
       * Whose account each seat was, read now rather than inside the queue.
       *
       * Paid whether or not they are still sitting here: a bet that rode the
       * spin after its owner stood up is still their bet, and skipping it was
       * the bank keeping a win it owed. The next window forgets departed seats,
       * so this cannot wait until the queue comes round.
       */
      const owners = new Map([...spin.keys()].map((seatId) => [seatId, table.accountOf(seatId)]));
      await serially(table, async () => {
        for (const [seatId, paid] of spin) {
          const seat = { id: seatId, userId: owners.get(seatId) ?? null };
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
              rounds: 1,
              roundsWon: paid.back > paid.staked ? 1 : 0,
              chipsWon: paid.back - paid.staked,
              chipsStaked: paid.staked,
            },
            game: ROULETTE.id,
            add: { spins: 1 },
          });
        }
        paidOut.add(spin);
        unpaid.delete(table);
      });
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
            if (!stakeFun(table, seat.id, bet.chips)) {
              return;
            }
            try {
              table.place(seat.id, bet.spotId, bet.chips);
            } catch {
              // The window shut while it was thinking. Give the chips back.
              refundFun(table, seat.id, bet.chips);
            }
          },
        };
      }
      return null;
    },
  };
}
