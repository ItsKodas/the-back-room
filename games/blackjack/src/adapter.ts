import type { BotMove, Clock, GameAdapter, GameDeps } from "@backroom/core";
import { ledgerOf, seatLimit, TableError } from "@backroom/core";
import { betFor, decide, thinkingTime, upcardValue } from "./bot.js";
import { maxStake, maxStakeAgainst, stillOwed } from "./bank.js";
import { value } from "./hand.js";
import { BLACKJACK } from "./listing.js";
import { Table, TURN_MS } from "./table.js";

/**
 * What the room does with a blackjack table.
 *
 * The interesting difference from Greed is when money moves. Greed takes every
 * stake once at the deal and pays a pot at the end; blackjack takes each stake
 * as it is placed, takes more again on a double, and settles every hand
 * separately. That is why taking chips belongs to the game rather than to the
 * server — the server would have had to know which of those two it was.
 */
/** What a table needs of the chips everybody before it has staked. */
export interface Bank {
  holds(): Promise<number>;
  add(amount: number): Promise<void>;
  /** Pays out, or returns false rather than overdrawing. */
  take(amount: number): Promise<boolean>;
}

export function blackjackAdapter(
  options: {
    random?: () => number;
    /** How long the felt is open for bets. An argument so a test can hurry it. */
    bettingMs?: number;
    /** How long a finished hand stays up to be read. */
    settleMs?: number;
    /** How much of the betting window takes no more chips. */
    lastCallMs?: number;
    /** How long one player may think before the table plays their hand. */
    turnMs?: number;
    /**
     * The bank these tables pay from, when there is one.
     *
     * Without it a chips table takes stakes off accounts and hands winnings
     * back with nothing in between — the players who beat the dealer are paid
     * in chips that did not exist. With it, every stake goes in before the
     * cards are settled and every payout comes out, so the table can only ever
     * hand over what somebody put there.
     *
     * It is also what lets a table deal to one player. Against a bank the
     * house is a real counterparty holding real chips; without one, a lone
     * player beating the dealer is a button that mints.
     */
    bank?: Bank;
  } = {},
): GameAdapter<Table> {
  const random = options.random ?? Math.random;
  const turnMs = options.turnMs ?? TURN_MS;
  const bank = options.bank ?? null;

  /*
   * The book every table paid from this bank keeps together.
   *
   * Every blackjack table in the building is paid from one bank, so a round
   * budget worked out against this felt alone reads every other felt's stakes
   * as headroom — chips those tables' winners may be owed. See `BankLedger`
   * for the whole of why.
   */
  const ledger = bank === null ? null : ledgerOf(bank);

  /** Whether this table's chips are the bank's, and so in the book. */
  const banked = (table: Table): boolean => ledger !== null && !table.forFun;

  /** Rounds that have been paid, known by the dealer's hand each one dealt. */
  const paidOut = new WeakSet<object>();

  /**
   * A round handed to `settle` and still waiting its turn in the queue.
   *
   * Counted apart from the table, because the table does not wait for it: a
   * felt cleared for the next round no longer says what the last one is owed.
   */
  const unpaid = new WeakMap<Table, { round: object; back: number }>();

  /**
   * What a void still has to hand back, between closing the escrow and its
   * turn actually coming up in `serially`.
   *
   * Counted apart from the table for the same reason `unpaid` is: the escrow
   * closes synchronously, well before the refunds it already counted as owed
   * have left the bank, and the table itself has nothing left to say so.
   */
  const pendingVoid = new WeakMap<Table, number>();

  /**
   * A leaver's refund taken off the escrow's queue and not yet out of the
   * bank.
   *
   * The same gap `pendingVoid` covers, on the leave path: once `takeDue` has
   * emptied the queue, nothing on the table or in the escrow says those chips
   * are still owed, but they sit in the bank until each take has gone through.
   */
  const leaveRefunding = new WeakMap<Table, number>();

  /** The most this table could still take out of the bank. */
  const owing = (table: Table): number => {
    // A called-off table owes only what its own void has not yet paid back
    // out of the bank — not a flat zero, or an act queued behind the void in
    // `serially` would read those chips as headroom before they have
    // actually left the bank, and put its own reservation back on the way
    // out.
    //
    // A leaver's refund already under way is counted either side of the
    // close: a void can close the escrow while that refund is still waiting
    // on the bank, and the chips are no less in there for it.
    const leaving = leaveRefunding.get(table) ?? 0;
    if (table.escrow.closed) {
      return (pendingVoid.get(table) ?? 0) + leaving;
    }
    const waiting = unpaid.get(table);
    /*
     * And a leaver's bet still queued. Standing up during betting takes the
     * bet off the felt at once, so the seats below no longer count it, while
     * the chips stay in the bank until the next broadcast pays them — and
     * another table's bet in that gap would be capped against them.
     */
    let total = waiting?.back ?? 0;
    total += leaving;
    for (const one of table.escrow.due) {
      total += one.chips;
    }
    if (table.dealer !== waiting?.round && !paidOut.has(table.dealer)) {
      for (const seat of table.seats) {
        total += stillOwed(seat.hands);
      }
    }
    return total;
  };

  /**
   * Runs something that moves this table's chips in the bank's own queue, and
   * tells the book what the table owes once it has.
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

  /**
   * Chips out of the bank and back to where they came from, in the bank's own
   * queue. Only ever stakes — everything here went into the bank as it was
   * placed — so a refusal means something outside the book moved the bank.
   */
  const handBack = async (
    table: Table,
    owed: readonly { userId: string; chips: number }[],
    deps: GameDeps,
    // Run once this work is done, still inside `serially` — so a caller with
    // its own book-keeping to clear can do it before anything queued behind
    // this turn gets a chance to read it.
    after?: () => void,
  ) =>
    serially(table, async () => {
      try {
        await giveBack(table, owed, deps);
      } finally {
        after?.();
      }
    });

  /** `handBack`'s work, for a caller already inside `serially`. */
  const giveBack = async (
    table: Table,
    owed: readonly { userId: string; chips: number }[],
    deps: GameDeps,
  ) => {
    for (const one of owed) {
      if (bank !== null && banked(table) && !(await bank.take(one.chips))) {
        console.error(
          `blackjack ${table.code}: the bank refused ${one.chips} owed back to ${one.userId}`,
        );
        continue;
      }
      await deps.give(one.userId, one.chips);
    }
  };

  return {
    listing: BLACKJACK,

    create(code, made) {
      // Fixed at the table rather than changeable later: a table anybody may
      // sit at and a table that spends real chips are not the same game with
      // a different label.
      const table = new Table(
        code,
        random,
        made?.["forFun"] === true,
        seatLimit(made?.["maxSeats"], BLACKJACK.maxSeats),
      );
      /*
       * A table with a bank behind it plays against the house, so it does not
       * need a second player — the counterparty is the chips everybody who
       * played here before put in. Without one it waits, as it always has.
       */
      table.housed = bank !== null;
      table.turnMs = turnMs;
      if (options.bettingMs !== undefined) {
        table.bettingMs = options.bettingMs;
        table.deadline = Date.now() + options.bettingMs;
      }
      if (options.settleMs !== undefined) {
        table.settleMs = options.settleMs;
      }
      if (options.lastCallMs !== undefined) {
        table.lastCallMs = options.lastCallMs;
      }
      return table;
    },

    async act(table, seatId, action, deps) {
      const move = action as { type?: string; amount?: number; ms?: number; ready?: boolean };
      const seat = table.seats.find((candidate) => candidate.id === seatId);
      if (seat === undefined) {
        throw new TableError("You are not at this table.");
      }

      await serially(table, async () => {
        switch (move.type) {
          case "bet": {
            const amount = Number(move.amount);
            // Betting happens before any split, so there is one hand to stake.
            const already = seat.hands[0]?.bet ?? 0;
            // Validated by the table first, so a refusal costs nobody anything.
            table.bet(seatId, amount);
            /*
             * Play money never leaves the table, so there is nothing here to do
             * and nobody to ask — which is exactly what lets a guest sit down.
             */
            if (table.forFun) {
              return;
            }
            if (seat.userId === null) {
              throw new TableError("Sign in to play for chips.");
            }
            /*
             * What the bank can cover, checked before the chips move. The whole
             * worst hand — split, both doubled, both won — has to be payable out
             * of what is in there, and a bet the bank cannot cover is refused
             * rather than paid out of nothing later.
             *
             * A budget for the round rather than an allowance per chair, because
             * the dealer turns one hand over and every seat settles against it.
             * Six players each holding the per-seat cap is six times the
             * exposure that cap was derived to cover: the bank emptied partway
             * down the row and the last winner got their stake back instead of
             * their winnings.
             */
            if (bank !== null) {
              /*
               * The stakes already on this felt come back out of what the bank
               * holds. They went in as they were placed, so asking the bank
               * partway through a betting window gives a fatter answer every
               * time somebody bets — and the chips making it fatter are the very
               * ones those seats may have to be paid out of. Counting them as
               * headroom is how a table talked itself into a round it could not
               * settle.
               */
              // Asked first, and the felt read after it without yielding in
              // between: a bet landing mid-question would otherwise be counted
              // in the bank and not on the table, which is the fatter answer
              // again by another route.
              //
              // Less what every other table on this bank could owe, for the same
              // reason one level up: their stakes are in there too, and they are
              // the chips those tables' winners would be paid out of.
              const held = (await bank.holds()) - (ledger?.owedElsewhere(table) ?? 0);
              const others = table.seats
                .filter((other) => other.id !== seatId)
                .map((other) => other.hands[0]?.bet ?? 0);
              const free = held - others.reduce((total, bet) => total + bet, 0) - already;
              const cap = maxStakeAgainst(free, others);
              if (amount > cap) {
                table.bet(seatId, already);
                throw new TableError(
                  cap < 1
                    ? maxStake(free) < 1
                      ? "The bank is empty. Nothing to play for yet."
                      : "The bank is covering the rest of this hand. Wait for the next one."
                    : `The bank covers ${cap.toLocaleString("en-US")} more on this hand.`,
                );
              }
            }
            // Only the difference, so changing a bet before the deal does not
            // charge twice for the same hand.
            const owed = amount - already;
            if (owed > 0 && !(await deps.take(seat.userId, owed))) {
              // Back to what was on the felt before, which zero can now express.
              table.bet(seatId, already);
              throw new TableError("You cannot cover that bet.");
            }
            if (owed > 0 && !table.escrow.hold(seat.userId, owed)) {
              await deps.give(seat.userId, owed);
              // Back to what was on the felt before, the same as a refused
              // take: a hold refused after the chips already moved is still a
              // bet that never happened.
              table.bet(seatId, already);
              throw new TableError("This table is closing.");
            }
            if (owed < 0) {
              // What escrow actually gives back, never the nominal drop: a
              // void between this stake going in and the bet shrinking may
              // already have refunded this account, and handing it back
              // again would pay it twice.
              const back = table.escrow.release(seat.userId, -owed);
              if (back > 0) {
                await deps.give(seat.userId, back);
              }
              /*
               * Only what actually came back out of the bank. A void already
               * took the rest of a lowered bet out of the bank when it paid
               * the refund itself; taking it again here would empty the bank
               * twice for one stake.
               */
              await bank?.add(-back);
              /*
               * The felt already shows the lowered amount from the optimistic
               * update above, but a void that closed the escrow first has
               * already refunded the whole stake this hand once — there is no
               * lowered bet left to show, only the one this table already
               * paid back.
               */
              if (back < -owed && table.escrow.closed) {
                table.bet(seatId, already);
              }
            } else if (owed > 0) {
              /*
               * Into the bank as it leaves the account. The stake is in there
               * before the cards are dealt, which is what makes the payout
               * arithmetic hold.
               */
              await bank?.add(owed);
            }
            /*
             * The last bet can be the thing that finishes the window: somebody
             * who was already ready, then bet, is ready again the moment the
             * chips land. Without this the table would sit waiting for a click
             * that has already happened.
             */
            if (table.everyoneReady) {
              table.deal();
            }
            return;
          }
          case "deal":
            /*
             * Hurrying the clock along, not starting the round — the round
             * starts itself. Kept to the host because cutting short everybody
             * else's time to bet is not a thing any seat should be able to do.
             */
            if (seatId !== table.hostId) {
              throw new TableError("Only the host can deal early.");
            }
            table.deal();
            return;
          case "ready": {
            /*
             * Not the host's call, unlike dealing early. Saying you have
             * finished betting is a statement about your own hand; it only ends
             * the window once everybody else has said it too, so it takes
             * nobody's time away from them.
             */
            table.setReady(seatId, move.ready !== false);
            if (table.everyoneReady) {
              table.deal();
            }
            return;
          }
          case "window":
            /*
             * How long everybody gets to bet, which is the host's call for the
             * same reason dealing early is: it is a decision about everybody
             * else's time rather than about one hand.
             */
            if (seatId !== table.hostId) {
              throw new TableError("Only the host can change the window.");
            }
            table.setWindow(Number(move.ms));
            return;
          case "hit":
            table.hit(seatId);
            return;
          case "stand":
            table.stand(seatId);
            return;
          case "double": {
            if (table.forFun) {
              // The table keeps the purse; doubling against it is its own affair.
              table.double(seatId);
              return;
            }
            if (seat.userId === null) {
              throw new TableError("Sign in to play for chips.");
            }
            // Asked for before it happens: doubling into chips you do not have
            // would leave a hand staked at more than was ever taken.
            const extra = seat.hands[seat.active]?.bet ?? 0;
            if (!(await deps.take(seat.userId, extra))) {
              throw new TableError("You cannot cover a double.");
            }
            /*
             * Held before the table plays it, not after: a double can be the
             * last decision left, and the table settles the round right
             * inside this call when it is — which hands the round's whole
             * stake to the result and empties the escrow synchronously. Held
             * afterwards, this stake would land in an escrow already emptied
             * by that settlement and never be spoken for by anything again.
             */
            if (!table.escrow.hold(seat.userId, extra)) {
              await deps.give(seat.userId, extra);
              throw new TableError("This table is closing.");
            }
            try {
              table.double(seatId);
            } catch (error) {
              // What escrow actually gives back, not the nominal stake — the
              // same reason a lowered bet does it this way.
              const back = table.escrow.release(seat.userId, extra);
              if (back > 0) {
                await deps.give(seat.userId, back);
              }
              throw error;
            }
            // In before the card is turned, like every other stake here.
            await bank?.add(extra);
            return;
          }
          case "split": {
            if (table.forFun) {
              // The table keeps the purse; splitting against it is its own affair.
              table.split(seatId);
              return;
            }
            if (seat.userId === null) {
              throw new TableError("Sign in to play for chips.");
            }
            /*
             * The second hand costs the same as the first, and is asked for
             * before the cards move for the same reason a double is: a split
             * paid for afterwards is two hands staked on one hand's chips.
             */
            const stake = seat.hands[seat.active]?.bet ?? 0;
            if (!(await deps.take(seat.userId, stake))) {
              throw new TableError("You cannot cover a split.");
            }
            // Held before the table plays it, for the same reason a double
            // is: splitting a pair of aces finishes both hands in one move,
            // and the table settles a round it finished right inside the call.
            if (!table.escrow.hold(seat.userId, stake)) {
              await deps.give(seat.userId, stake);
              throw new TableError("This table is closing.");
            }
            try {
              table.split(seatId);
            } catch (error) {
              // What escrow actually gives back, not the nominal stake — the
              // same reason a lowered bet does it this way.
              const back = table.escrow.release(seat.userId, stake);
              if (back > 0) {
                await deps.give(seat.userId, back);
              }
              throw error;
            }
            await bank?.add(stake);
            return;
          }
          default:
            throw new TableError("That is not something you can do here.");
        }
      });
    },

    isSettled(table) {
      return table.phase === "settled";
    },

    /**
     * Who beat the dealer, however many hands it took.
     *
     * Up on the deal rather than up on a hand, which is the same line `settle`
     * draws when it records a win: a split that takes one hand and loses more
     * on the other did not win.
     *
     * Unlike `settle`, this answers for a for-fun table too. Nothing is owed
     * there and nothing is recorded, but somebody still won the hand, and
     * things outside the game are staked on that — a taunt thrown at a player
     * is paid for in real chips whatever the table is dealing for.
     */
    winners(table) {
      return table.seats
        .filter((seat) => {
          const out = seat.hands.reduce((total, hand) => total + hand.bet, 0);
          const back = seat.hands.reduce((total, hand) => total + hand.returned, 0);
          return out > 0 && back > out;
        })
        .map((seat) => seat.id);
    },

    /** Bets owed back to somebody who stood up while the felt was still open. */
    async payOut(table, deps) {
      if (table.escrow.due.length === 0) {
        return;
      }
      await serially(table, async () => {
        /*
         * Taken inside the queue rather than before it. Taken outside, the
         * queue is empty and the refund counted nowhere for as long as the
         * bank's queue takes to reach it. Still exactly-once: two broadcasts
         * queue behind each other and the second finds nothing, and a void's
         * `close()` empties the queue synchronously before it queues at all.
         */
        const owed = table.escrow.takeDue();
        if (owed.length === 0) {
          return;
        }
        // Counted until the chips have actually left the bank, and cleared
        // before `serially` tells the book what the table owes on the way out.
        leaveRefunding.set(
          table,
          owed.reduce((total, one) => total + one.chips, 0),
        );
        try {
          await giveBack(table, owed, deps);
        } finally {
          leaveRefunding.delete(table);
        }
      });
    },

    /**
     * Calls the table off: every stake still on the felt, back to whoever put
     * it there, and this table's claim on the bank released.
     */
    async void(table, deps) {
      const owed = table.escrow.close();
      // Set before this joins `serially`: the escrow is already closed, and
      // `owing` has to answer with what these refunds still are, not zero,
      // for as long as they are still sitting in the bank.
      pendingVoid.set(
        table,
        owed.reduce((total, one) => total + one.chips, 0),
      );
      await handBack(table, owed, deps, () => pendingVoid.delete(table));
      ledger?.release(table);
      return owed;
    },

    /**
     * The table's own clock, which is what makes it a table rather than a
     * game somebody has to run.
     *
     * Two waits, and the server treats them the same way: the felt is open for
     * bets until a deadline, and a finished hand sits where it is for a moment
     * so it can be read. Between them there is nothing to wait for — a hand
     * being played waits on people, and people have a clock of their own.
     */
    pause(table) {
      if (table.phase === "betting" && table.deadline !== null) {
        return {
          key: "betting",
          ms: Math.max(0, table.deadline - Date.now()),
          run() {
            table.closeBetting();
          },
        };
      }
      if (table.phase === "settled") {
        return {
          key: "settled",
          ms: table.deadline === null ? table.settleMs : Math.max(0, table.deadline - Date.now()),
          run() {
            table.beginBetting();
          },
        };
      }
      return null;
    },

    /**
     * Whose decision is running out.
     *
     * A table that deals itself cannot wait forever on somebody who has walked
     * away from their screen, and everybody else at it is waiting on the same
     * person.
     */
    clock(table): Clock | null {
      const seat = table.currentSeat();
      if (table.phase !== "playing" || seat === null) {
        return null;
      }
      /*
       * The table's own deadline, stamped when the turn began. Worked out here
       * instead it moved every time it was asked for — and the room asks on
       * every broadcast, so the turn it was meant to end never ended.
       */
      const endsAt = table.turnEndsAt;
      return endsAt === null ? null : { seatId: seat.id, endsAt };
    },

    timeout(table, seatId) {
      table.timeout(seatId);
    },

    /**
     * What a seated bot wants to do next.
     *
     * Two jobs, because a bot at a card table has two: put something on the
     * felt before the deal, and play the hand afterwards. It calls the table
     * directly rather than going back through `act` — `act` charges an account
     * for a stake, and a bot has no account to charge, which is the same
     * reason `settle` pays it nothing.
     */
    botMove(table): BotMove | null {
      if (table.phase === "betting") {
        // Last call binds a bot too. Nothing to offer once the felt has
        // stopped taking chips, which is also what ends this loop: a bot that
        // never bets is asked again, and after last call the answer is none.
        if (table.lastCall) {
          return null;
        }
        const waiting = table.seats.find(
          (seat) => seat.isBot && !seat.waiting && (seat.hands[0]?.bet ?? 0) === 0,
        );
        if (waiting === undefined) {
          return null;
        }
        const skill = waiting.skill ?? "normal";
        return {
          seatId: waiting.id,
          delayMs: thinkingTime(skill),
          play() {
            // It may have thought right through last call, and the table would
            // refuse the bet — which here would be a throw with nobody to hear
            // it, because there is no player behind this move.
            if (!table.lastCall) {
              table.bet(waiting.id, betFor(skill));
            }
          },
        };
      }

      if (table.phase !== "playing") {
        return null;
      }
      const seat = table.currentSeat();
      if (seat === null || !seat.isBot) {
        return null;
      }
      const skill = seat.skill ?? "normal";
      /*
       * The upcard, not the dealer's hand. A bot holds the same table object a
       * player's socket does and could read the hole card straight off it, so
       * only the one card everybody can see is passed along.
       */
      const up = table.dealer[0];
      if (up === undefined) {
        return null;
      }
      const upcard = upcardValue(up);
      return {
        seatId: seat.id,
        delayMs: thinkingTime(skill),
        play() {
          // Whichever of its hands is in front of it. A bot that split reads
          // the second hand the same way it read the first.
          const hand = table.currentHand();
          if (hand === null) {
            return;
          }
          const move = decide({
            cards: hand.cards,
            upcard,
            canDouble: hand.cards.length === 2,
            canSplit: hand.cards.length === 2 && !hand.fromSplit,
            skill,
          });
          if (move === "hit") {
            table.hit(seat.id);
            return;
          }
          if (move === "double") {
            // No chips are taken: a bot has none. What it costs is recorded on
            // the seat all the same, so the hand it plays is the real one.
            table.double(seat.id);
            return;
          }
          if (move === "split") {
            table.split(seat.id);
            return;
          }
          table.stand(seat.id);
        },
      };
    },

    /**
     * Hands back what each seat is owed.
     *
     * The stakes are already gone — taken as they were placed — so this only
     * ever gives. A loss is simply nothing coming back.
     */
    async settle(table, deps) {
      /*
       * Nothing to settle at a table playing for nothing. The purse was paid
       * by the table itself, and a hand that cost nobody anything belongs in
       * no record: counting it would make a win rate mean two things at once,
       * the same reason a friendly game of Greed goes unrecorded.
       */
      if (table.forFun) {
        return;
      }

      const staked = (seat: { hands: Array<{ bet: number }> }) =>
        seat.hands.reduce((total, hand) => total + hand.bet, 0);
      const paid = (seat: { hands: Array<{ returned: number }> }) =>
        seat.hands.reduce((total, hand) => total + hand.returned, 0);

      /*
       * Everything read off the table before anything is awaited.
       *
       * This is a settlement, so it has to talk to the economy, so it yields —
       * and the table does not stand still while it does. A continuous table
       * clears the felt on a timer, and a loop that read `seat.hands` after an
       * await would find them emptied and pay the rest of the room nothing.
       * The hand is over; what it was worth is a fact now, not a place to look
       * things up later.
       */
      const played = table.seats
        .filter((seat) => !seat.waiting && staked(seat) > 0)
        .map((seat) => ({
          userId: seat.userId,
          name: seat.name,
          isBot: seat.isBot,
          out: staked(seat),
          back: paid(seat),
          outcomes: seat.hands.map((hand) => hand.outcome),
          // No score in blackjack, so what the hand was worth stands in. After
          // a split there are two, and the better of them is the fairer answer
          // to "how did that go" than whichever happened to be dealt first.
          score: Math.max(...seat.hands.map((hand) => value(hand.cards).total)),
          seatId: seat.id,
        }));
      // And counted in the book as owed until it is paid, for the same reason.
      const round = table.dealer;
      if (banked(table)) {
        unpaid.set(table, { round, back: played.reduce((total, seat) => total + seat.back, 0) });
      }

      await serially(table, async () => {
        for (const seat of played) {
          if (seat.userId === null) {
            continue;
          }
          /*
           * The seat's whole account for the hand, not one of its hands.
           *
           * A split can win on one and lose on the other, and paying or counting
           * those separately would make one deal look like two games — the win
           * rate would drift every time somebody split, which is exactly the
           * kind of quiet wrongness a stats page never admits to.
           */
          if (seat.back > 0) {
            /*
             * Out of the bank before it reaches the account, and only if the
             * bank actually holds it.
             *
             * Every seat's worst hand was budgeted against the bank less what
             * every other table on it could owe, so nothing in this building can
             * make this refuse. It is still asked rather than assumed, because
             * the alternative to asking is a bank that goes negative in silence
             * and a table that has quietly started minting chips — and a bank
             * moved from outside the book, by another process or a hand on the
             * database, is not something this table can rule out.
             *
             * If it does refuse, the player keeps their stake rather than being
             * paid winnings the building has not got — and only as much of it as
             * the bank can still find, because handing back a stake out of a
             * bank that no longer holds it is minting in the one branch nobody
             * watches. Loudly, because that player has been short-paid.
             */
            if (bank !== null && !(await bank.take(seat.back))) {
              console.error(
                `blackjack ${table.code}: the bank refused ${seat.back} owed to ${seat.userId}`,
              );
              const rescued = Math.min(seat.out, await bank.holds());
              if (rescued > 0 && (await bank.take(rescued))) {
                await deps.give(seat.userId, rescued);
              }
            } else {
              await deps.give(seat.userId, seat.back);
            }
          }
          await deps.record(seat.userId, {
            shared: {
              rounds: 1,
              roundsWon: seat.back > seat.out ? 1 : 0,
              chipsWon: seat.back - seat.out,
              chipsStaked: seat.out,
            },
            game: BLACKJACK.id,
            add: {
              blackjacks: seat.outcomes.filter((outcome) => outcome === "blackjack").length,
              busts: seat.outcomes.filter((outcome) => outcome === "bust").length,
              // A split that pushes both hands is one push, not two: this counts
              // hands where the outcome was a push, which is what it says.
              pushes: seat.outcomes.filter((outcome) => outcome === "push").length,
            },
            max: { biggestWin: Math.max(0, seat.back - seat.out) },
          });
        }

        await deps.finished({
          code: table.code,
          rulesetName: "Blackjack",
          // A hand has no single stake and no pot to divide; the totals are what
          // the history can honestly say about it.
          buyIn: 0,
          pot: played.reduce((total, seat) => total + seat.out, 0),
          players: played.map((seat) => ({
            userId: seat.userId,
            name: seat.name,
            score: seat.score,
            isBot: seat.isBot,
            // The stake was taken as it was placed, so this is the whole story
            // of the hand: what came back, less what went out.
            net: seat.back - seat.out,
          })),
          // Up on the deal, however many hands it took. One hand winning while
          // the other loses more is not a win, and should not be recorded as one.
          winnerIds: played
            .filter((seat) => seat.back > seat.out)
            .map((seat) => seat.userId ?? seat.seatId),
          endedAt: Date.now(),
        });
        paidOut.add(round);
        unpaid.delete(table);
      });
    },
  };
}
