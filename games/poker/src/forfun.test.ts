import { describe, expect, it } from "vitest";
import type { Card } from "./cards.js";
import { pokerAdapter } from "./adapter.js";
import { blindsFor, stakeFor, STAKES } from "./listing.js";
import { decide, strength } from "./bot.js";
import type { Seat } from "./table.js";
import { FUN_STACK, Table } from "./table.js";

/**
 * A table playing for nothing, and the bots that only sit at one.
 *
 * The rules of the game do not change here — a hand is a hand. What changes is
 * everything either side of it: who may sit down, who may be dealt in, and
 * above all where the chips came from and where they go. That last one is the
 * line the whole building is arranged around, so most of this file is about it.
 */

const identity = (userId: string) => ({ userId, avatar: null, accentColor: null });

function funTable(maxSeats = 6): Table {
  let at = 1;
  const random = () => {
    at = (at * 1103515245 + 12345) % 2147483648;
    return at / 2147483648;
  };
  return new Table("FUN01", random, 50, 100, maxSeats, 30_000, true);
}

function chipsTable(): Table {
  return new Table("CHP01", Math.random, 50, 100, 6);
}

describe("who may sit at a table playing for nothing", () => {
  it("lets somebody with no account sit down", () => {
    // Nobody signs in to play for nothing, and asking them to would be asking
    // for a name to write on a receipt that is never issued.
    const table = funTable();
    expect(() => table.join("a", "Ada", null)).not.toThrow();
  });

  it("still turns a guest away from a table playing for chips", () => {
    const table = chipsTable();
    expect(() => table.join("a", "Ada", null)).toThrow(/sign in/i);
  });

  it("seats a bot with play money in front of it", () => {
    const table = funTable();
    const bot = table.addBot("bot:1", "Pockets", "normal");
    expect(bot.isBot).toBe(true);
    expect(bot.stack).toBe(FUN_STACK);
  });

  it("refuses a bot at a table playing for chips", () => {
    /*
     * The rule the building rests on, at the one door it could walk through. A
     * bot has no account to take chips from and none to pay them to, so a hand
     * won against one for real chips is chips from nowhere.
     */
    const table = chipsTable();
    expect(() => table.addBot("bot:1", "Pockets", "normal")).toThrow(/for fun/i);
  });
});

describe("where the play money goes", () => {
  it("owes nobody anything when a signed-in player stands up", () => {
    /*
     * The one that would actually mint chips, and it is not far-fetched: a
     * signed-in player sitting at a for-fun table is the ordinary case, and
     * paying their play-money stack into their account is a button that prints
     * money. Guarded on the table rather than on whether the seat has a user.
     */
    const table = funTable();
    table.join("a", "Ada", identity("u1"));
    table.addBot("bot:1", "Pockets", "normal");
    table.buyIn("a", FUN_STACK);
    table.deal();

    table.leave("a");

    expect(table.escrow.due).toEqual([]);
  });

  it("still owes a signed-in player their stack at a table playing for chips", () => {
    // The other half of the same check: the guard is about the table, and must
    // not have quietly switched off paying people at a real one.
    const table = chipsTable();
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bram", identity("u2"));
    table.buyIn("a", 2_000);
    table.buyIn("b", 2_000);

    table.leave("a");

    expect(table.escrow.due).toEqual([{ userId: "u1", chips: 2_000 }]);
  });

  it("asks the economy for nothing when somebody sits down for fun", async () => {
    /*
     * Through the adapter, because that is the only place poker ever touches
     * an account — and the whole point of a for-fun table is that this call
     * never happens.
     */
    const adapter = pokerAdapter();
    const table = adapter.create("FUN01", { forFun: true }) as Table;
    table.join("a", "Ada", identity("u1"));

    const asked: string[] = [];
    await adapter.act(
      table,
      "a",
      { type: "buyIn" },
      {
        take: async () => {
          asked.push("take");
          return true;
        },
        give: async () => {
          asked.push("give");
        },
        record: async () => undefined,
        finished: async () => undefined,
      },
    );

    expect(asked).toEqual([]);
    expect(table.seats[0]?.stack).toBe(FUN_STACK);
  });
});

describe("a bot with a hand in front of it", () => {
  const card = (text: string): Card => {
    const suits = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const;
    return {
      rank: text.slice(0, -1) as Card["rank"],
      suit: suits[text.slice(-1) as keyof typeof suits],
    };
  };

  /** A seat holding two named cards, and nothing else that matters here. */
  const holding = (one: string, two: string, stack = 2_000): Seat =>
    ({
      id: "bot:1",
      name: "Pockets",
      hole: [card(one), card(two)],
      stack,
      committed: 0,
      paid: 0,
      folded: false,
      allIn: false,
      acted: false,
      waiting: false,
      showed: null,
      isBot: true,
      skill: "normal",
      connected: true,
      userId: null,
      avatar: null,
      accentColor: null,
    }) as unknown as Seat;

  const felt = { board: [] as Card[], bigBlind: 100 };
  /* No randomness, so a decision is the same decision every run. */
  const never = () => 1;

  it("thinks more of aces than of a seven-deuce", () => {
    expect(strength(holding("As", "Ad"), [])).toBeGreaterThan(
      strength(holding("7s", "2d"), []),
    );
  });

  it("reads a made hand off the board rather than guessing", () => {
    const board = [card("Ah"), card("Ac"), card("Kd"), card("2s"), card("9h")];
    // Trips against nothing at all, on the same five cards.
    expect(strength(holding("As", "5d"), board)).toBeGreaterThan(
      strength(holding("7s", "3d"), board),
    );
  });

  it("checks rather than folds when staying in is free", () => {
    // Folding a hand that owes nothing is the one move that can only lose.
    const choice = decide(holding("7s", "2d"), felt, 0, 200, 2_000, "normal", never);
    expect(choice.move).toBe("check");
  });

  it("folds rubbish that costs something", () => {
    const choice = decide(holding("7s", "2d"), felt, 100, 200, 2_000, "normal", never);
    expect(choice.move).toBe("fold");
  });

  it("pays for a hand worth paying for", () => {
    const choice = decide(holding("As", "Ad"), felt, 100, 200, 2_000, "normal", never);
    expect(choice.move).toBe("call");
  });

  it("never asks to raise beyond what it has", () => {
    /*
     * A raise past the stack is refused by the table, and refused inside a bot
     * move is a throw with nobody behind it to hear — so it is caught here
     * rather than there.
     */
    const always = () => 0;
    for (const stack of [120, 300, 1_000, 5_000]) {
      const seat = holding("As", "Ad", stack);
      const most = seat.committed + seat.stack;
      const choice = decide(seat, felt, 100, Math.min(200, most), most, "normal", always);
      if (choice.move === "raise") {
        expect(choice.to).toBeLessThanOrEqual(most);
      }
    }
  });
});

describe("a whole hand against bots", () => {
  it("plays itself out without anybody being owed a chip", () => {
    const table = funTable();
    table.join("a", "Ada", identity("u1"));
    table.buyIn("a", FUN_STACK);
    table.addBot("bot:1", "Pockets", "normal");
    table.addBot("bot:2", "Old Ned", "easy");
    const adapter = pokerAdapter();

    table.deal();
    expect(table.street).toBe("preflop");

    /*
     * The bots move themselves; Ada folds the moment she is asked. What this
     * is really watching is that a table of mostly bots reaches the end of a
     * hand at all — a bot that stalls on its own turn is a table that never
     * comes round again.
     */
    for (let step = 0; step < 60 && table.street !== "showdown"; step += 1) {
      if (table.toAct === "a") {
        table.act("a", "fold");
        continue;
      }
      const move = adapter.botMove?.(table) ?? null;
      if (move === null) {
        break;
      }
      move.play();
    }

    expect(table.street).toBe("showdown");
    expect(table.escrow.due).toEqual([]);
    // Every play chip still at the table: nothing was minted and nothing lost.
    const total = table.seats.reduce((sum, seat) => sum + seat.stack, 0) + table.pot;
    expect(total).toBe(FUN_STACK * 3);
  });
});

/*
 * What a table costs to sit down at.
 *
 * The host's decision, and the one number in the create payload that says how
 * much of somebody else's balance is at risk — so it is the one the game has
 * to take back off the client rather than take at its word.
 */
describe("what it costs to sit down", () => {
  it("snaps whatever was asked for to a level the house actually deals", () => {
    expect(stakeFor(2_000)).toBe(2_000);
    expect(stakeFor(1_900)).toBe(2_000);
    expect(stakeFor(7_000)).toBe(5_000);
    expect(STAKES).toContain(stakeFor(123_456));
  });

  it("takes nothing on trust: junk becomes the ordinary level", () => {
    for (const junk of [undefined, null, "10000", Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(STAKES).toContain(stakeFor(junk));
    }
  });

  it("gives every level whole-chip blinds, a hundred of the big one to the buy-in", () => {
    for (const level of STAKES) {
      const { small, big } = blindsFor(level);
      expect(Number.isInteger(small)).toBe(true);
      expect(Number.isInteger(big)).toBe(true);
      expect(big * 100).toBe(level);
      expect(small * 2).toBe(big);
    }
  });

  it("charges what the host chose rather than the default", async () => {
    const adapter = pokerAdapter();
    const table = adapter.create("STK01", { buyIn: 5_000 }) as Table;
    table.join("a", "Ada", identity("u1"));

    const taken: number[] = [];
    await adapter.act(
      table,
      "a",
      { type: "buyIn" },
      {
        take: async (_who, amount) => {
          taken.push(amount);
          return true;
        },
        give: async () => undefined,
        record: async () => undefined,
        finished: async () => undefined,
      },
    );

    expect(taken).toEqual([5_000]);
    expect(table.seats[0]?.stack).toBe(5_000);
    // And the stakes came with it, rather than staying at the default.
    expect(table.bigBlind).toBe(50);
    expect(table.smallBlind).toBe(25);
  });

  it("sits a bot down with the same stack everybody else buys", () => {
    const table = new Table("FUN02", Math.random, 25, 50, 6, 30_000, true, 5_000);
    expect(table.addBot("bot:1", "Pockets", "normal").stack).toBe(5_000);
  });
});

/*
 * Turning over a hand nobody could make you turn over.
 *
 * A hand that was not called does not have to be shown, and the felt keeps
 * that. This is the player choosing to anyway.
 */
describe("showing a hand", () => {
  function heldUp(): Table {
    let at = 7;
    const random = () => {
      at = (at * 1103515245 + 12345) % 2147483648;
      return at / 2147483648;
    };
    const table = new Table("SHW01", random, 50, 100, 6, 30_000, true, 2_000);
    table.join("a", "Ada", identity("u1"));
    table.addBot("bot:1", "Pockets", "normal");
    table.buyIn("a", 2_000);
    table.deal();
    return table;
  }

  it("refuses while there is still a hand being played", () => {
    /*
     * Showing your cards to people still deciding what to do about them is not
     * a flourish, it is handing them the hand.
     */
    const table = heldUp();
    expect(table.street).toBe("preflop");
    expect(() => table.show("a")).toThrow(/nothing to show/i);
    expect(table.canShow("a")).toBe(false);
  });

  it("turns them face up for everybody, not only for their owner", () => {
    const table = heldUp();
    // Everybody but one folds, so the hand ends without a showdown between them.
    while (table.street !== "showdown" && table.toAct !== null) {
      table.act(table.toAct, "fold");
    }
    expect(table.street).toBe("showdown");

    const stillHolding = table.seats.find((seat) => table.canShow(seat.id));
    expect(stillHolding).toBeDefined();

    const who = (stillHolding as { id: string }).id;
    table.show(who);

    const seen = table.view("somebody else").seats.find((seat) => seat.id === who);
    expect(seen?.hole.filter((card) => card !== null)).toHaveLength(2);
    expect(table.lastEvent).toMatch(/showed/i);
  });

  it("shows two cards without pretending they are a hand", () => {
    /*
     * A hand that ended before the flop is two cards, and two cards cannot be
     * read as anything — the first version of this threw trying. They are
     * still theirs to turn over; the felt simply has nothing to call them.
     */
    const table = heldUp();
    while (table.street !== "showdown" && table.toAct !== null) {
      table.act(table.toAct, "fold");
    }
    expect(table.board).toHaveLength(0);

    const who = (table.seats.find((seat) => table.canShow(seat.id)) as { id: string }).id;
    expect(() => table.show(who)).not.toThrow();

    const seen = table.view(null).seats.find((seat) => seat.id === who);
    expect(seen?.hole.filter((card) => card !== null)).toHaveLength(2);
    expect(seen?.showed).toBeNull();
    expect(table.lastEvent).toMatch(/showed their hand/i);
  });

  it("names the hand when there are five cards to name it from", () => {
    const table = heldUp();
    // Played to the river, so there is a hand rather than two cards.
    while (table.street !== "showdown" && table.toAct !== null) {
      const seat = table.seats.find((one) => one.id === table.toAct);
      table.act(table.toAct, table.owed(seat as never) > 0 ? "call" : "check");
    }
    expect(table.board.length).toBeGreaterThanOrEqual(3);

    const holder = table.seats.find((seat) => table.canShow(seat.id));
    if (holder === undefined) {
      // Everybody turned over at the showdown already, which is the other
      // correct outcome and leaves nothing for this test to do.
      return;
    }
    table.show(holder.id);
    expect(holder.showed).not.toBeNull();
  });

  it("says so once and then has nothing left to say", () => {
    const table = heldUp();
    while (table.street !== "showdown" && table.toAct !== null) {
      table.act(table.toAct, "fold");
    }
    const who = (table.seats.find((seat) => table.canShow(seat.id)) as { id: string }).id;
    table.show(who);
    expect(table.canShow(who)).toBe(false);
    // And asking again is not an error, it is simply already done.
    expect(() => table.show(who)).not.toThrow();
  });
});

/*
 * Taking chips back off the table without leaving it.
 *
 * The rule that matters is when: a player who could lift their stack mid-hand
 * could sit down, see a flop, and take the money back when it missed.
 */
describe("cashing out", () => {
  const chips = () => new Table("CSH01", Math.random, 50, 100, 6, 30_000, false, 2_000);

  it("hands the stack back between hands, and keeps the seat", () => {
    const table = chips();
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bram", identity("u2"));
    table.buyIn("a", 2_000);

    expect(table.canTakeOff("a")).toBe(true);
    expect(table.takeOffTable("a")).toBe(2_000);

    expect(table.escrow.due).toEqual([{ userId: "u1", chips: 2_000 }]);
    expect(table.seats).toHaveLength(2);
    expect(table.seats.find((seat) => seat.id === "a")?.stack).toBe(0);
  });

  it("refuses while you are holding cards", () => {
    /*
     * The one that would be a way to bet nothing: see a flop, and if it misses
     * pick your stack up off the felt.
     */
    const table = chips();
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bram", identity("u2"));
    table.buyIn("a", 2_000);
    table.buyIn("b", 2_000);
    table.deal();

    expect(table.canTakeOff("a")).toBe(false);
    expect(() => table.takeOffTable("a")).toThrow(/mid-hand/i);
    expect(table.escrow.due).toEqual([]);
  });

  it("lets somebody who has folded take what is left", () => {
    // Their bet stays in the pot; the rest was never in the hand.
    const table = chips();
    table.join("a", "Ada", identity("u1"));
    table.join("b", "Bram", identity("u2"));
    table.buyIn("a", 2_000);
    table.buyIn("b", 2_000);
    table.deal();
    const first = table.toAct as string;
    table.act(first, "fold");

    expect(table.canTakeOff(first)).toBe(true);
  });

  it("owes an account nothing at a table playing for nothing", () => {
    // Play money dies with the table, whichever door it goes out of.
    const table = new Table("FUN03", Math.random, 50, 100, 6, 30_000, true, 2_000);
    table.join("a", "Ada", identity("u1"));
    table.buyIn("a", 2_000);

    expect(table.takeOffTable("a")).toBe(2_000);
    expect(table.escrow.due).toEqual([]);
  });

  it("has nothing to hand back when there is nothing in front of you", () => {
    const table = chips();
    table.join("a", "Ada", identity("u1"));
    expect(table.canTakeOff("a")).toBe(false);
  });
});

/*
 * Who won, as the room asks it.
 *
 * Nothing in poker needs this — a hand pays itself out of its own pot. It is
 * asked because things outside the game ride on winning: a taunt thrown at a
 * player is paid for in real chips whatever the table is dealing for, so a
 * friendly hand has to come good the same way a paid one does.
 */
describe("telling the room who won", () => {
  function played(): Table {
    let at = 11;
    const random = () => {
      at = (at * 1103515245 + 12345) % 2147483648;
      return at / 2147483648;
    };
    const table = new Table("WIN01", random, 50, 100, 6, 30_000, true, 2_000);
    table.join("a", "Ada", identity("u1"));
    table.addBot("bot:1", "Pockets", "normal");
    table.buyIn("a", 2_000);
    table.deal();
    while (table.street !== "showdown" && table.toAct !== null) {
      const seat = table.seats.find((one) => one.id === table.toAct);
      table.act(table.toAct, table.owed(seat as never) > 0 ? "call" : "check");
    }
    return table;
  }

  it("says nothing while a hand is still being played", () => {
    const adapter = pokerAdapter();
    const table = adapter.create("WIN02", { forFun: true }) as Table;
    table.join("a", "Ada", identity("u1"));
    table.addBot("bot:1", "Pockets", "normal");
    table.buyIn("a", 2_000);
    table.deal();

    // The room only asks a settled table, and a table mid-hand is not one.
    expect(adapter.isSettled(table)).toBe(false);
  });

  it("names the seats that took the pot, once the hand is read", () => {
    const adapter = pokerAdapter();
    const table = played();
    expect(table.street).toBe("showdown");
    expect(adapter.isSettled(table)).toBe(true);

    const won = adapter.winners?.(table) ?? [];
    expect(won.length).toBeGreaterThan(0);
    // Everybody named actually has a seat, and actually took chips.
    for (const seatId of won) {
      expect(table.seats.some((seat) => seat.id === seatId)).toBe(true);
      expect(table.paid.some((one) => one.seatId === seatId && one.chips > 0)).toBe(true);
    }
  });

  it("stops being settled once the felt is cleared", () => {
    /*
     * Which is what lets the room ask again next hand: it latches a settled
     * table and only unlatches when it stops being one.
     */
    const adapter = pokerAdapter();
    const table = played();
    table.finish();
    expect(table.street).toBe("waiting");
    expect(adapter.isSettled(table)).toBe(false);
  });

  it("still owes an account nothing for any of it", () => {
    // Settled here means "a hand finished", not "chips are owed". The pot went
    // from stacks to stacks; nothing left the table.
    const table = played();
    expect(table.escrow.due).toEqual([]);
  });
});
