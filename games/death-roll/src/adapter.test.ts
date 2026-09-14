import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { deathRollAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** An account that always has chips, and a note of everything asked of it. */
const spy = (enough = true) => {
  const took = vi.fn(async () => enough);
  const gave = vi.fn(async () => {});
  const deps = {
    take: took,
    give: gave,
    record: vi.fn(async () => {}),
    finished: vi.fn(async () => {}),
  } as unknown as GameDeps;
  return { deps, took, gave };
};

/** A table with two signed-in players at it, ready to be dealt. */
const seated = (game: ReturnType<typeof deathRollAdapter>, options = {}) => {
  const table = game.create("ABCDE", { buyIn: 500, ceiling: 1_000, ...options }) as Table;
  table.join("ada", "Ada", who("u1"));
  table.join("bob", "Bob", who("u2"));
  return table;
};

/** Starts a duel the way the room does: the table asks, payOut answers. */
const deal = async (
  game: ReturnType<typeof deathRollAdapter>,
  table: Table,
  deps: GameDeps,
) => {
  table.askForDuel();
  return await game.payOut?.(table, deps);
};

describe("getting a duel started", () => {
  it("takes an ante from each player and opens the pot with both", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps, took } = spy();

    await deal(game, table, deps);

    expect(took).toHaveBeenCalledWith("u1", 500);
    expect(took).toHaveBeenCalledWith("u2", 500);
    expect(table.view(null).pot).toBe(1_000);
    expect(table.phase).toBe("dueling");
  });

  it("asks to be seen, because nothing else will send this state", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps } = spy();

    expect(await deal(game, table, deps)).toBe(true);
  });

  it("says nothing when there was no duel waiting to start", async () => {
    // Called on every broadcast, so the common case is that it has no work.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const { deps } = spy();

    expect(await game.payOut?.(table, deps)).toBeFalsy();
  });

  it("gives the first ante back when the second is refused", async () => {
    /*
     * The one that matters most here. A duel that took one ante and failed the
     * second would be a table holding somebody's stake for a game that never
     * happened — and `take` really can refuse, because a balance can be spent
     * at another table between sitting down and the duel coming round.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const took = vi
      .fn<(userId: string, amount: number) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const gave = vi.fn(async () => {});
    const deps = {
      take: took,
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);

    expect(gave).toHaveBeenCalledWith("u1", 500);
    expect(table.phase).toBe("waiting");
    expect(table.view(null).pot).toBe(0);
    expect(table.view(null).waitingFor).toBe("funds");
    expect(table.view(null).shortId).toBe("bob");
  });

  it("never deals to one player, whatever it is asked", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = game.create("ABCDE", { buyIn: 500 }) as Table;
    table.join("ada", "Ada", who("u1"));
    const { deps, took } = spy();

    await deal(game, table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(table.phase).toBe("waiting");
  });

  it("does not tell everybody again while the same seat is still short", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const deps = {
      take: vi.fn(async () => false),
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    expect(await deal(game, table, deps)).toBe(true);
    expect(await deal(game, table, deps)).toBe(false);
  });

  it("says who is short even when handing the first ante back fails", async () => {
    /*
     * The refund is the only thing standing between a refused second ante and
     * a stake held for a game that never happened, and it is a database write
     * like any other — it can fail. If it does, the felt must still say why
     * the table stopped, because a table that says nothing goes back round on
     * the fast clock and takes that same ante again every couple of seconds.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const deps = {
      take: vi
        .fn<(userId: string, amount: number) => Promise<boolean>>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      give: vi.fn(async () => {
        throw new Error("the store is down");
      }),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    // Loudly, too: the room logs this, and it is somebody's chips.
    await expect(deal(game, table, deps)).rejects.toThrow("the store is down");
    expect(table.view(null).shortId).toBe("bob");
    expect(table.view(null).waitingFor).toBe("funds");
  });

  it("gives the first ante back when the second one throws", async () => {
    /*
     * `deps.take` is a real write to a real store: it can reject outright as
     * well as answer no. The refused answer was always handed back — a thrown
     * one is the same stake held for a game that never happened, and there is
     * no bank here for it to be held out of.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const gave = vi.fn(async () => {});
    const deps = {
      take: vi
        .fn<(userId: string, amount: number) => Promise<boolean>>()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("the store is down")),
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await expect(deal(game, table, deps)).rejects.toThrow("the store is down");

    expect(gave).toHaveBeenCalledWith("u1", 500);
    expect(table.phase).toBe("waiting");
    expect(table.view(null).pot).toBe(0);
  });

  it("deals nobody in who left while the antes were in flight", async () => {
    /*
     * The worst of the lot. A seat asked to go is dropped there and then while
     * no duel is running, which is the state for the whole of `payOut` — so a
     * player can be debited after leaving, and a duel opened on a seat that is
     * gone. The clock then rolls for the ghost, and if it wins there is nobody
     * to pay: the entire pot disappears.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const gave = vi.fn(async () => {});
    const deps = {
      take: vi.fn(async (userId: string) => {
        if (userId === "u2") {
          table.removeSeat("ada");
        }
        return true;
      }),
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);

    expect(table.duel).toBeNull();
    expect(table.phase).toBe("waiting");
    expect(gave).toHaveBeenCalledWith("u1", 500);
    expect(gave).toHaveBeenCalledWith("u2", 500);
  });

  it("does not arm a second deal while the antes are in flight", async () => {
    /*
     * `payOut` is unlatched and runs on every broadcast, and for the whole of
     * its awaits the table looks exactly like one with nothing pending. A deal
     * timer armed in that window fires into a second `payOut`, which takes two
     * more antes and opens a duel the first one then throws away — four antes
     * off accounts for a pot of two.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    let armed: string | undefined;
    const deps = {
      take: vi.fn(async () => {
        armed = game.pause?.(table)?.key;
        return true;
      }),
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);

    expect(armed).toBeUndefined();
  });

  it("asks the seat that was short last time before anybody else's chips move", async () => {
    /*
     * A table whose second player cannot cover the ante retries every ten
     * seconds for as long as they sit there, and in plain seat order that
     * means the first player is debited and refunded every single time — two
     * real writes against a real balance, either of which can fail, for a duel
     * that was never going to start. Asking the one who cannot pay first
     * refuses the attempt before anybody is out of pocket.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const took = vi.fn(async (userId: string) => userId !== "u2");
    const gave = vi.fn(async () => {});
    const deps = {
      take: took,
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);
    expect(table.view(null).shortId).toBe("bob");
    took.mockClear();
    gave.mockClear();

    await deal(game, table, deps);

    expect(took).toHaveBeenCalledTimes(1);
    expect(took).toHaveBeenCalledWith("u2", 500);
    expect(gave).not.toHaveBeenCalled();
  });

  it("deals the duel to exactly the two seats that paid for it", async () => {
    /*
     * `payOut` takes the antes from the seats it was handed, and `begin` used
     * to go and work out who was playing all over again — two sources of truth
     * for one question, with the money resting on the first of them. Taking an
     * ante is a real await, and the table is free to move while it runs.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const deps = {
      take: vi.fn(async () => {
        const bob = table.seats.find((seat) => seat.id === "bob");
        if (bob !== undefined) {
          bob.waiting = true;
        }
        return true;
      }),
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);

    expect(table.phase).toBe("dueling");
    expect(table.view(null).pot).toBe(1_000);
  });

  it("waits longer before trying a refused ante again", async () => {
    // Still asking — they may top up — but not every two seconds.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game);
    const deps = {
      take: vi.fn(async () => false),
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;
    await deal(game, table, deps);

    const waiting = game.pause?.(table);

    expect(waiting?.key).toBe("short");
    expect(waiting?.ms).toBe(10_000);
  });
});

describe("rolling and passing", () => {
  it("rolls from the source it was given", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);

    expect(table.view(null).ceiling).toBe(743);
  });

  it("takes the price of a pass off the account and adds it to the pot", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps, took } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;
    took.mockClear();

    await game.act(table, first, { type: "pass" }, deps);

    expect(took).toHaveBeenCalledWith(first === "ada" ? "u1" : "u2", 50);
    expect(table.view(null).pot).toBe(1_050);
  });

  it("refuses a pass the player cannot pay for, without spending it", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;
    const broke = spy(false);

    await expect(game.act(table, first, { type: "pass" }, broke.deps)).rejects.toThrow(
      TableError,
    );
    expect(table.view(null).pot).toBe(1_000);
    expect(table.view(null).seats.find((seat) => seat.id === first)?.passed).toBe(false);
  });

  it("hands a pass back when the table moved on while the chips were in flight", async () => {
    /*
     * Taking the price of a pass is a real write to a real store, and the
     * world moves while it is in flight: the turn clock can fire and roll for
     * this seat, or a second press can arrive — there is no lock on a table
     * and the rate limit is sixty events every two seconds. The duel then
     * refuses the pass, and a player charged for a pass that never reached the
     * pot is chips gone from a game with no bank to lose them out of.
     */
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;

    const gave = vi.fn(async () => {});
    const racing = {
      take: vi.fn(async () => {
        game.timeout?.(table, first);
        return true;
      }),
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await expect(game.act(table, first, { type: "pass" }, racing)).rejects.toThrow(TableError);
    expect(gave).toHaveBeenCalledWith(first === "ada" ? "u1" : "u2", 50);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("refuses a move from somebody who is not at the table", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await expect(game.act(table, "cat", { type: "roll" }, deps)).rejects.toThrow(TableError);
  });

  it("refuses anything that is not a move here", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await expect(
      game.act(table, table.view(null).toRoll as string, { type: "double" }, deps),
    ).rejects.toThrow(TableError);
  });
});

describe("settling", () => {
  it("gives the winner the pot and takes nothing more from anybody", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps, took, gave } = spy();
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;
    took.mockClear();

    await game.act(table, loser, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    await game.settle(table, deps);

    const winner = loser === "ada" ? "u2" : "u1";
    expect(gave).toHaveBeenCalledWith(winner, 1_000);
    expect(took).not.toHaveBeenCalled();
  });

  it("stakes the ante and every pass bought on top of it", async () => {
    /*
     * A pass is chips on the felt, not a fee: the winner takes the loser's
     * passes inside the pot. So what a seat staked is its ante plus whatever
     * it spent passing, which is not the same as the net either of them ends
     * up with — the whole reason the board keeps the two figures apart.
     */
    const rolls = [743, 1];
    const game = deathRollAdapter({ roll: () => rolls.shift() as number });
    const table = seated(game);
    const { deps, took } = spy();
    await deal(game, table, deps);
    const passer = table.view(null).toRoll as string;

    await game.act(table, passer, { type: "pass" }, deps);
    const price = took.mock.calls.at(-1)?.[1] as number;
    const second = table.view(null).toRoll as string;
    await game.act(table, second, { type: "roll" }, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    const staked = (seatId: string) =>
      (deps.record as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === (seatId === "ada" ? "u1" : "u2"),
      )?.[1]?.shared?.chipsStaked;

    expect(price).toBeGreaterThan(0);
    expect(staked(passer)).toBe(500 + price);
    expect(staked(passer === "ada" ? "bob" : "ada")).toBe(500);
  });

  it("hands out exactly what it was handed, passes and all", async () => {
    /*
     * The rule the whole building rests on, checked as arithmetic: the pot in
     * equals the pot out. There is no bank here to make up a difference, so a
     * mismatch is chips minted or chips vanished.
     */
    const rolls = [743, 1];
    const game = deathRollAdapter({ roll: () => rolls.shift() as number });
    const table = seated(game);
    const { deps, took, gave } = spy();
    await deal(game, table, deps);
    const first = table.view(null).toRoll as string;

    await game.act(table, first, { type: "pass" }, deps);
    const second = table.view(null).toRoll as string;
    await game.act(table, second, { type: "roll" }, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    const takenIn = took.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0);
    const paidOut = gave.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0);
    expect(takenIn).toBe(1_050);
    expect(paidOut).toBe(1_050);
  });

  it("names the winner for whatever is riding on them", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;

    await game.act(table, loser, { type: "roll" }, deps);

    expect(game.winners?.(table)).toEqual([loser === "ada" ? "bob" : "ada"]);
  });

  it("writes the duel into the history with both nets", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    const finished = deps.finished as unknown as ReturnType<typeof vi.fn>;
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;

    await game.act(table, loser, { type: "roll" }, deps);
    await game.settle(table, deps);

    const record = finished.mock.calls[0]?.[0] as { players: { net: number }[]; pot: number };
    expect(record.pot).toBe(1_000);
    expect(record.players.map((one) => one.net).sort((a, b) => a - b)).toEqual([-500, 500]);
  });

  it("settles once and stays settled while the result is up", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    table.finish();
    expect(game.isSettled(table)).toBe(false);
  });
});

describe("a seat that goes mid-duel", () => {
  /*
   * The room reaps a seat ninety seconds after it drops, whatever the table is
   * doing — and an absent player burns thirty seconds of turn clock every
   * turn, so a duel routinely outlives that. `leavesMidHand: false` promises
   * the seat is held until the hand is over, and the pot rests on it: a winner
   * whose seat had already gone would be both antes paid to nobody.
   */
  it("holds the seat so the duel still settles to whoever won it", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps, gave } = spy();
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;
    const winner = loser === "ada" ? "bob" : "ada";

    table.removeSeat(winner);
    await game.act(table, loser, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(table.seats.map((seat) => seat.id)).toContain(winner);
    expect(gave).toHaveBeenCalledWith(winner === "ada" ? "u1" : "u2", 1_000);
  });

  it("lets the seat go once the felt is cleared", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;
    const winner = loser === "ada" ? "bob" : "ada";

    table.removeSeat(winner);
    await game.act(table, loser, { type: "roll" }, deps);
    await game.settle(table, deps);

    // Held right up until the pot is paid, and then honoured.
    expect(table.seats.map((seat) => seat.id)).toContain(winner);
    table.finish();
    expect(table.seats.map((seat) => seat.id)).toEqual([loser]);
  });

  it("records no settlement it did not pay", async () => {
    /*
     * Defensive, now that a seat is held until the felt clears — but a
     * settlement written for a pot that was never paid is worse than a lost
     * pot: it is a win on somebody's profile and a figure in the history for
     * chips that never moved.
     */
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps, gave } = spy();
    const finished = deps.finished as unknown as ReturnType<typeof vi.fn>;
    table.begin(undefined, ["ada", "ghost"]);
    table.duel?.roll("ada", () => 1);

    // Loudly: an unpaid pot is the worst thing that can happen at this table,
    // and the room logs what it cannot fix.
    await expect(game.settle(table, deps)).rejects.toThrow(/pot unpaid/);

    expect(gave).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  });
});

describe("a table playing for nothing", () => {
  it("never touches an account, over a whole duel", async () => {
    /*
     * The rule is in CLAUDE.md in so many words, and it is also the mistake
     * that has actually happened in this repo — a verification run opened a
     * chips table by accident and spent somebody's real balance. So the
     * assertion is not that the right amount moved but that nothing was asked
     * of the account at all.
     */
    const game = deathRollAdapter({ roll: () => 1 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.join("bob", "Bob", null);
    const { deps, took, gave } = spy();

    await deal(game, table, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(gave).not.toHaveBeenCalled();
  });

  it("moves the play purses instead, and they still sum to nothing", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.join("bob", "Bob", null);
    const { deps } = spy();

    await deal(game, table, deps);
    const loser = table.view(null).toRoll as string;
    await game.act(table, loser, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(table.purseFor("ada") + table.purseFor("bob")).toBe(20_000);
    expect(table.purseFor(loser)).toBe(9_500);
  });

  it("refills a purse too short for the ante rather than stopping play", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.join("bob", "Bob", null);
    table.movePurse("ada", -9_800);
    const { deps } = spy();

    await deal(game, table, deps);

    expect(table.phase).toBe("dueling");
    expect(table.purseFor("ada")).toBe(9_500);
  });
});

describe("who may sit down", () => {
  it("refuses a bot at a table playing for chips", () => {
    // The line the whole economy rests on: a bot at a chips table is a button
    // somebody holds down. Refused by the table, not hidden by the client.
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);

    expect(() => table.addBot("bot:1", "Bot", "normal")).toThrow(TableError);
    expect(table.seats).toHaveLength(2);
  });

  it("plays a bot's turn at a table playing for nothing", () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.addBot("bot:1", "Bot", "normal");
    table.begin("bot:1");

    const move = game.botMove?.(table);

    expect(move?.seatId).toBe("bot:1");
    move?.play();
    expect(table.view(null).ceiling).toBe(743);
  });

  it("has nothing for a bot to do when it is not their turn", () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500 }) as Table;
    table.join("ada", "Ada", null);
    table.addBot("bot:1", "Bot", "normal");
    table.begin("ada");

    expect(game.botMove?.(table)).toBeNull();
  });
});

describe("the table's own clock", () => {
  it("rolls for somebody whose time runs out rather than forfeiting", async () => {
    /*
     * Rolling is chance either way, so a clock cannot disadvantage an absent
     * player — there is no decision being taken from them. Forfeiting would
     * let a bad connection lose somebody their stake, which is the one thing a
     * clock must never do.
     */
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);
    const waiting = table.view(null).toRoll as string;

    game.timeout?.(table, waiting);

    expect(table.view(null).ceiling).toBe(743);
    expect(table.view(null).toRoll).not.toBe(waiting);
  });

  it("puts the clock on whoever is to act", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = seated(game);
    const { deps } = spy();
    await deal(game, table, deps);

    const clock = game.clock?.(table);

    expect(clock?.seatId).toBe(table.view(null).toRoll);
    expect(clock?.endsAt).toBeGreaterThan(Date.now());
  });

  it("waits for a second player without asking for a duel", async () => {
    const game = deathRollAdapter({ roll: () => 743 });
    const table = game.create("ABCDE", { buyIn: 500 }) as Table;
    table.join("ada", "Ada", who("u1"));

    expect(game.pause?.(table)).toBeNull();
  });

  it("asks for a duel once there are two, and clears the felt after one", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game);
    const { deps } = spy();

    const waiting = game.pause?.(table);
    expect(waiting?.key).toBe("deal");
    waiting?.run();
    expect(table.pending).toBe(true);

    await game.payOut?.(table, deps);
    await game.act(table, table.view(null).toRoll as string, { type: "roll" }, deps);

    const result = game.pause?.(table);
    expect(result?.key).toBe("result");
    result?.run();
    expect(table.phase).toBe("waiting");
  });
});
