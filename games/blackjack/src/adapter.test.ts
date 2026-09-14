import type { GameDeps } from "@backroom/core";
import { describe, expect, it } from "vitest";
import { blackjackAdapter } from "./adapter.js";
import { maxStake } from "./bank.js";
import type { Card, Rank } from "./cards.js";

/** A ledger that records what the game asked to move, without a database. */
function ledger(balances: Record<string, number> = {}) {
  const moves: string[] = [];
  const deps: GameDeps = {
    async take(userId, amount) {
      if ((balances[userId] ?? 0) < amount) {
        moves.push(`refused ${userId} -${amount}`);
        return false;
      }
      balances[userId] = (balances[userId] ?? 0) - amount;
      moves.push(`take ${userId} ${amount}`);
      return true;
    },
    async give(userId, amount) {
      balances[userId] = (balances[userId] ?? 0) + amount;
      moves.push(`give ${userId} ${amount}`);
    },
    async record() {},
    async finished() {},
  };
  return { deps, moves, balances };
}

const identity = (userId: string) => ({ userId, avatar: null, accentColor: null });

/**
 * Somebody else at the table, who never bets.
 *
 * A table playing for chips will not deal to one person — chips are only won
 * from real people. This seats a second one so these tests can be about what
 * they are about. They never stake anything, so they are never dealt in and
 * every arranged shoe below still reaches the hand it was arranged for.
 */
function seatCompany(table: { join: (id: string, name: string, who: unknown) => unknown }): void {
  table.join("z", "Bo", identity("u-company"));
}

describe("who may change the window", () => {
  it("lets the host, because it is everybody's time", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "window", ms: 60_000 }, deps);

    expect(table.bettingMs).toBe(60_000);
  });

  it("refuses anybody else, for the same reason", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    table.join("b", "Bo", identity("u2"));
    const { deps } = ledger({ u1: 10_000, u2: 10_000 });

    await expect(
      game.act(table, "b", { type: "window", ms: 15_000 }, deps),
    ).rejects.toThrow(/only the host/i);
    expect(table.bettingMs).toBe(30_000);
  });
});

describe("a bot at the felt", () => {
  // Bots only ever sit at a table playing for nothing, so every test here does.
  const funTable = () => blackjackAdapter().create("FUN01", { forFun: true });

  it("does not bet once last call has gone out", () => {
    const game = blackjackAdapter();
    const table = funTable();
    table.join("a", "Ada", identity("u1"));
    table.addBot("bot", "Cassie", "normal");

    // While the window is open there is a bet waiting to be made.
    expect(game.botMove?.(table)).not.toBeNull();

    table.deadline = Date.now() + 2000;
    expect(game.botMove?.(table)).toBeNull();
  });

  it("holds its chips when it thinks right through last call", () => {
    const game = blackjackAdapter();
    const table = funTable();
    table.join("a", "Ada", identity("u1"));
    const bot = table.addBot("bot", "Cassie", "normal");
    const move = game.botMove?.(table);

    // Offered while the window was open, played after it shut.
    table.deadline = Date.now() + 2000;
    move?.play();

    expect(bot.hands[0]?.bet).toBe(0);
  });
});

describe("what blackjack does with chips", () => {
  it("takes a stake as it is placed, not at the deal", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances, moves } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);

    expect(balances["u1"]).toBe(9000);
    expect(moves).toEqual(["take u1 1000"]);
  });

  it("charges only the difference when a bet is changed", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    await game.act(table, "a", { type: "bet", amount: 1500 }, deps);
    // Not 2,500: changing your mind before the deal is not two bets.
    expect(balances["u1"]).toBe(8500);

    await game.act(table, "a", { type: "bet", amount: 500 }, deps);
    expect(balances["u1"]).toBe(9500);
  });

  it("takes nothing for a bet that arrives after last call", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances, moves } = ledger({ u1: 10_000 });
    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    // The deal a moment away, rather than half a minute of waiting.
    table.deadline = Date.now() + 2000;

    await expect(
      game.act(table, "a", { type: "bet", amount: 1500 }, deps),
    ).rejects.toThrow(/last call/i);

    // Refused by the table before the account was ever asked.
    expect(balances["u1"]).toBe(9000);
    expect(moves).toEqual(["take u1 1000"]);
  });

  it("gives back a stake pulled off the felt after last call", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances } = ledger({ u1: 10_000 });
    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    table.deadline = Date.now() + 2000;

    await game.act(table, "a", { type: "bet", amount: 0 }, deps);

    expect(balances["u1"]).toBe(10_000);
  });

  it("refuses a bet that cannot be covered, and leaves the seat alone", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances } = ledger({ u1: 300 });

    await expect(
      game.act(table, "a", { type: "bet", amount: 1000 }, deps),
    ).rejects.toThrow(/cannot cover/i);
    expect(balances["u1"]).toBe(300);
    expect(table.seats[0]?.hands[0]?.bet).toBe(0);
  });

  it("takes the extra for a double before dealing the card", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    await game.act(table, "a", { type: "deal" }, deps);
    if (table.phase === "playing" && table.seats[0]?.hands[0]?.cards.length === 2) {
      await game.act(table, "a", { type: "double" }, deps);
      expect(balances["u1"]).toBe(8000);
      expect(table.seats[0]?.hands[0]?.bet).toBe(2000);
    }
  });

  it("will not double on chips that are not there", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, balances } = ledger({ u1: 1000 });

    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    await game.act(table, "a", { type: "deal" }, deps);
    expect(balances["u1"]).toBe(0);
    if (table.phase === "playing") {
      await expect(game.act(table, "a", { type: "double" }, deps)).rejects.toThrow(/cannot cover/i);
      // The hand is untouched: no third card, and the stake is what it was.
      expect(table.seats[0]?.hands[0]?.bet).toBe(1000);
    }
  });

  it("only ever gives at settlement, because the stakes are already gone", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps, moves } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    await game.act(table, "a", { type: "deal" }, deps);
    while (table.phase === "playing") {
      await game.act(table, "a", { type: "stand" }, deps);
    }
    expect(game.isSettled(table)).toBe(true);

    const before = moves.length;
    await game.settle(table, deps);
    // Whatever the outcome, settlement never takes anything.
    expect(moves.slice(before).every((move) => move.startsWith("give"))).toBe(true);
  });

  it("pays the hand that was played, not the one the clock started", async () => {
    /*
     * The bug this is here for: settlement talks to the economy, so it yields,
     * and a table that runs itself clears the felt on a timer. Settling by
     * reading the seats after each await paid whatever was left of the hand —
     * which, once the next betting window had opened, was nothing.
     */
    const game = blackjackAdapter({ settleMs: 60 });
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);

    const moves: string[] = [];
    let counted: number | null = null;
    let reported: number | null = null;
    // Held at the first thing settlement asks the economy for, whatever that
    // turns out to be: a losing hand never calls give at all.
    let open = () => {};
    const released = new Promise<void>((resolve) => {
      open = resolve;
    });
    let reached = () => {};
    const parked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let held = false;
    const hold = async () => {
      if (held) {
        return;
      }
      held = true;
      reached();
      await released;
    };
    const deps: GameDeps = {
      async take() {
        return true;
      },
      async give(userId, amount) {
        await hold();
        moves.push(`give ${userId} ${amount}`);
      },
      async record(_userId, entry) {
        await hold();
        counted = entry.shared?.chipsWon ?? null;
      },
      async finished(game_) {
        await hold();
        reported = game_.players[0]?.net ?? null;
      },
    };

    await game.act(table, "a", { type: "bet", amount: 1000 }, deps);
    await game.act(table, "a", { type: "deal" }, deps);
    while (table.phase === "playing") {
      await game.act(table, "a", { type: "stand" }, deps);
    }
    // What the hand was actually worth, read while it is still on the felt.
    const back = table.view().seats[0]?.hands.reduce((total, hand) => total + hand.returned, 0) ?? 0;

    const settling = game.settle(table, deps);
    await parked;
    // The clock, going off in the middle of settlement.
    table.beginBetting();
    open();
    await settling;

    expect(table.view().seats[0]?.bet).toBe(0);
    expect(moves).toEqual(back > 0 ? [`give u1 ${back}`] : []);
    expect(counted).toBe(back - 1000);
    expect(reported).toBe(back - 1000);
  });

  it("stakes what the seat put out, not what came back", async () => {
    let staked: number | null = null;
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps } = ledger({ u1: 10_000 });
    const watching: GameDeps = {
      ...deps,
      async record(_userId, entry) {
        staked = entry.shared?.chipsStaked ?? null;
      },
    };

    await game.act(table, "a", { type: "bet", amount: 1000 }, watching);
    await game.act(table, "a", { type: "deal" }, watching);
    while (table.phase === "playing") {
      await game.act(table, "a", { type: "stand" }, watching);
    }
    await game.settle(table, watching);

    // A thousand, whatever came back — a hand that won 2,000 still staked 1,000.
    expect(staked).toBe(1000);
  });

  it("refuses a verb it does not have", async () => {
    const game = blackjackAdapter();
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    seatCompany(table);
    const { deps } = ledger({ u1: 10_000 });
    await expect(game.act(table, "a", { type: "roll" }, deps)).rejects.toThrow(/not something/i);
  });
});

/*
 * The clock on somebody's turn.
 *
 * The server re-arms it on every broadcast, which is the point of the bug: a
 * deadline worked out fresh each time is a deadline that keeps moving, so the
 * turn it is supposed to end never ends and the felt has nothing steady enough
 * to count down.
 */
describe("how long a turn has left", () => {
  function playing() {
    const adapter = blackjackAdapter({ forFun: true } as never);
    const table = adapter.create("CLK01", { forFun: true }) as never as {
      join: (id: string, name: string, who: unknown) => unknown;
      bet: (id: string, amount: number) => void;
      deal: () => void;
      phase: string;
    };
    table.join("a", "Ada", identity("u1"));
    seatCompany(table as never);
    table.bet("a", 100);
    table.deal();
    return { adapter, table };
  }

  it("keeps the same deadline while the same seat is still to act", async () => {
    const { adapter, table } = playing();
    if (table.phase !== "playing") {
      // A natural blackjack settles inside `deal`; nothing to time.
      return;
    }

    const first = adapter.clock?.(table as never)?.endsAt ?? null;
    expect(first).not.toBeNull();

    // The room asks again on the very next broadcast, which is any change at
    // the table at all — a chat message, somebody sitting down.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = adapter.clock?.(table as never)?.endsAt ?? null;

    expect(second).toBe(first);
  });
});

/*
 * What the bank can cover for a whole round rather than for one seat.
 *
 * The cap is derived from the worst hand one seat can play, and a round
 * settles every seat at once. A felt full of players each staking the cap is
 * therefore several times the exposure the cap was worked out to cover, and
 * the bank runs out partway down the row: the seats settled first are paid and
 * the last one is handed its stake back instead of its winnings. Nothing is
 * minted, which is why this went unnoticed — but somebody who beat the dealer
 * was quietly short-paid, and that is the same money rule from the other side.
 */
describe("what the bank can cover across a whole table", () => {
  /** A bank that holds chips and will not overdraw, like the real one. */
  function vault(start: number) {
    let held = start;
    return {
      holds: () => held,
      bank: {
        async holds() {
          return held;
        },
        async add(amount: number) {
          held += amount;
        },
        async take(amount: number) {
          if (amount > held) {
            return false;
          }
          held -= amount;
          return true;
        },
      },
    };
  }

  /** A shoe dealing a known sequence, so a hand can be asserted about. */
  function stack(table: object, ranks: Rank[]): void {
    const cards: Card[] = ranks.map((rank) => ({ rank, suit: "spades" })).reverse();
    Object.defineProperty(table, "shoe", {
      value: {
        refresh() {},
        draw: () => cards.pop() ?? ({ rank: "2", suit: "hearts" } as Card),
      },
    });
  }

  it("pays every winner in full when the whole felt bets what it is offered", async () => {
    const start = 4_000;
    const cap = maxStake(start);
    const { bank } = vault(start);
    const game = blackjackAdapter({ bank });
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bo", identity("u2"));
    table.join("c", "Cy", identity("u3"));
    const { deps, balances } = ledger({ u1: 10_000, u2: 10_000, u3: 10_000 });

    /*
     * Three seats one after another, each asking for the cap the table is
     * advertising. A refusal is a fine answer — a bank this thin cannot seat
     * three players at the top stake and saying so is the fix. Being told yes
     * and then not being paid is not.
     */
    for (const seatId of ["a", "b", "c"]) {
      try {
        await game.act(table, seatId, { type: "bet", amount: cap }, deps);
      } catch {
        // Refused. The felt is untouched and the account was never asked.
      }
    }

    // Two rounds of cards, then the dealer's, the way the table deals: every
    // seat that got a bet down is dealt a blackjack, and the dealer is not.
    stack(table, ["A", "A", "A", "7", "K", "K", "K", "7"]);
    const staked = table.seats.map((seat) => seat.hands[0]?.bet ?? 0);
    await game.act(table, "a", { type: "deal" }, deps);
    while (table.phase === "playing") {
      await game.act(table, table.currentSeat()?.id ?? "a", { type: "stand" }, deps);
    }
    const owed = table.seats.map((seat) =>
      seat.hands.reduce((total, hand) => total + hand.returned, 0),
    );

    await game.settle(table, deps);

    // Whatever the table let each of them put up, that hand was a blackjack
    // and a blackjack pays three to two. Nobody goes home with their stake.
    for (const [at, seat] of table.seats.entries()) {
      expect({ seat: seat.name, chips: balances[seat.userId as string] }).toEqual({
        seat: seat.name,
        chips: 10_000 - (staked[at] as number) + (owed[at] as number),
      });
    }
  });

  it("hands back only what the bank has left rather than minting the rest", async () => {
    /*
     * The floor under the round budget, and the reason it stays.
     *
     * The budget is a promise about one table, and both blackjack tables in
     * the building are paid from the same bank — one settling mid-round can
     * still leave another short. When that happens the seat keeps its stake
     * instead of its winnings, which is the one answer that moves no chips
     * that do not exist. It has to be the stake the bank can actually find:
     * paying back a stake out of a bank that no longer holds it is minting,
     * quietly and in the one branch nobody watches.
     */
    const start = 40_000;
    const { bank, holds } = vault(start);
    const game = blackjackAdapter({ bank });
    const table = game.create("TEST1");
    table.join("a", "Ada", identity("u1"));
    const { deps, balances } = ledger({ u1: 10_000 });

    await game.act(table, "a", { type: "bet", amount: 1_000 }, deps);
    stack(table, ["A", "7", "K", "7"]);
    await game.act(table, "a", { type: "deal" }, deps);
    while (table.phase === "playing") {
      await game.act(table, "a", { type: "stand" }, deps);
    }

    // Another table settling in between, which is the whole of what the round
    // budget cannot promise: it takes the bank down below even the stake.
    await bank.take(holds() - 400);
    const chipsBefore = (balances["u1"] as number) + holds();

    await game.settle(table, deps);

    expect(holds()).toBeGreaterThanOrEqual(0);
    // Not a chip more than there was, which is the only rule that matters here.
    expect((balances["u1"] as number) + holds()).toBe(chipsBefore);
  });
});
