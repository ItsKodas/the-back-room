import type { GameDeps } from "@backroom/core";
import { TableError } from "@backroom/core";
import { describe, expect, it, vi } from "vitest";
import { deathRollAdapter } from "./adapter.js";
import type { Table } from "./table.js";

const who = (userId: string) => ({ userId, avatar: null, accentColor: null });

/** An account that always pays, noting everything asked of it. */
const spy = (take: (userId: string, amount: number) => Promise<boolean> = async () => true) => {
  const took = vi.fn(take);
  const gave = vi.fn(async (_userId: string, _amount: number) => {});
  const finished = vi.fn(async (_record: unknown) => {});
  const deps = {
    take: took,
    give: gave,
    record: vi.fn(async () => {}),
    finished,
  } as unknown as GameDeps;
  return { deps, took, gave, finished };
};

const sum = (calls: unknown[][]) => calls.reduce((total, call) => total + (call[1] as number), 0);

type Adapter = ReturnType<typeof deathRollAdapter>;

/** A chips table with these players sat at it, everybody ready. */
const seated = (game: Adapter, ...names: string[]) => {
  const table = game.create("ABCDE", { buyIn: 500, ceiling: 1_000, maxSeats: 6 }) as Table;
  for (const name of names) {
    table.join(name, name, who(`u-${name}`));
  }
  for (const name of names) {
    table.setReady(name, true, 0);
  }
  return table;
};

/** Deals the way the room does: the table asks, payOut answers. */
const deal = async (game: Adapter, table: Table, deps: GameDeps) => {
  table.askForGame(Date.now());
  return await game.payOut?.(table, deps);
};

describe("dealing a game", () => {
  it("takes an ante from everybody ready and deals them all", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took } = spy();

    expect(await deal(game, table, deps)).toBe(true);

    expect(took).toHaveBeenCalledTimes(3);
    expect(table.game?.players).toEqual(["ada", "bob", "cat"]);
    expect(table.view(null).pot).toBe(1_500);
  });

  it("sits out a player who cannot cover the ante, and deals the rest", async () => {
    // A short player no longer holds a table of people who can pay.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps } = spy(async (userId) => userId !== "u-cat");

    await deal(game, table, deps);

    expect(table.game?.players).toEqual(["ada", "bob"]);
    expect(table.view(null).seats.find((seat) => seat.id === "cat")?.short).toBe(true);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("hands every ante back and deals nobody when fewer than two can pay", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took, gave } = spy(async (userId) => userId === "u-ada");

    expect(await deal(game, table, deps)).toBe(true);

    expect(table.game).toBeNull();
    expect(sum(gave.mock.calls)).toBe(sum(took.mock.calls.filter((call) => call[0] === "u-ada")));
    expect(table.view(null).readyCount).toBe(0);
  });

  it("hands back everything taken when the store fails partway through, and says the table changed", async () => {
    /*
     * Answered rather than thrown: the room only sends the state again when
     * payOut says it moved something, so a throw here left every screen on
     * a deal that had already fallen through — ready still lit, no reason.
     */
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const game = deathRollAdapter({ roll: () => 500 });
      const table = seated(game, "ada", "bob", "cat");
      const { deps, gave } = spy(async (userId) => {
        if (userId === "u-cat") {
          throw new Error("store down");
        }
        return true;
      });

      expect(await deal(game, table, deps)).toBe(true);

      expect(table.game).toBeNull();
      expect(gave).toHaveBeenCalledWith("u-ada", 500);
      expect(gave).toHaveBeenCalledWith("u-bob", 500);
      expect(table.draining).toBe(false);
      expect(table.view(null).lastEvent).toMatch(/could not take the antes/);
      expect(table.view(null).readyCount).toBe(0);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("refunds a player who stood up while the antes were being taken, and deals without them", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, gave } = spy(async (userId) => {
      if (userId === "u-cat") {
        table.removeSeat("ada");
      }
      return true;
    });

    await deal(game, table, deps);

    expect(gave).toHaveBeenCalledWith("u-ada", 500);
    expect(table.game?.players).toEqual(["bob", "cat"]);
  });

  it("refunds a player who leaves while another's refund from the same deal is still in flight, and never deals a ghost", async () => {
    // The window I1 closes: a refund is itself an await, and who is left can
    // change again while it runs. cat's take triggers ada's departure; ada's
    // refund is rigged to trigger bob's, right in the middle of paying it back.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const took = vi.fn(async (userId: string) => {
      if (userId === "u-cat") {
        table.removeSeat("ada");
      }
      return true;
    });
    const gave = vi.fn(async (userId: string) => {
      if (userId === "u-ada") {
        table.removeSeat("bob");
      }
    });
    const deps = {
      take: took,
      give: gave,
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    await deal(game, table, deps);

    expect(table.game?.players ?? []).not.toContain("bob");
    expect(gave).toHaveBeenCalledWith("u-ada", 500);
    expect(gave).toHaveBeenCalledWith("u-bob", 500);
    expect(sum(took.mock.calls)).toBe(sum(gave.mock.calls) + table.view(null).pot);
  });

  it("takes no extra antes if a second deal is asked for and paid out while the first is still draining", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const took = vi.fn(async () => {
      await gate;
      return true;
    });
    const deps = {
      take: took,
      give: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      finished: vi.fn(async () => {}),
    } as unknown as GameDeps;

    table.askForGame(Date.now());
    const first = game.payOut?.(table, deps);

    table.askForGame(Date.now());
    const second = await game.payOut?.(table, deps);

    expect(second).toBe(false);

    release();
    await first;

    expect(took).toHaveBeenCalledTimes(2);
    expect(table.game?.players).toEqual(["ada", "bob"]);
  });

  it("does nothing, and says so, when no game was asked for", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();

    expect(await game.payOut?.(table, deps)).toBe(false);
  });

  it("offers no second deal while the antes are still being taken", async () => {
    // Four antes off accounts for a pot of two, otherwise.
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    let during: unknown = "unset";
    const { deps } = spy(async () => {
      during = game.pause?.(table) ?? null;
      return true;
    });

    await deal(game, table, deps);

    expect(during).toBeNull();
  });
});

describe("disconnecting", () => {
  it("does not charge or deal a ready player who disconnects before their ante is taken", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took } = spy();
    table.askForGame(Date.now());

    table.disconnect("cat");

    expect(await game.payOut?.(table, deps)).toBe(true);
    expect(took).toHaveBeenCalledTimes(2);
    expect(took).toHaveBeenCalledWith("u-ada", 500);
    expect(took).toHaveBeenCalledWith("u-bob", 500);
    expect(table.game?.players).toEqual(["ada", "bob"]);
    expect(table.view(null).seats.find((seat) => seat.id === "cat")?.short).toBe(false);
  });

  it("refunds and does not deal a funded player who presses Leave while a later ante is being taken", async () => {
    /*
     * Leave only disconnects at this table — the room reaps the seat later —
     * so a seat that is still there is not the same as a player who is.
     */
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, gave } = spy(async (userId) => {
      if (userId === "u-cat") {
        table.disconnect("ada");
      }
      return true;
    });

    await deal(game, table, deps);

    expect(gave).toHaveBeenCalledWith("u-ada", 500);
    expect(table.game?.players).toEqual(["bob", "cat"]);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("refunds everybody when a Leave mid-deal leaves fewer than two funded", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps, took, gave } = spy(async (userId) => {
      if (userId === "u-bob") {
        table.disconnect("ada");
      }
      return true;
    });

    await deal(game, table, deps);

    expect(table.game).toBeNull();
    expect(gave).toHaveBeenCalledWith("u-ada", 500);
    expect(gave).toHaveBeenCalledWith("u-bob", 500);
    expect(sum(gave.mock.calls)).toBe(sum(took.mock.calls));
  });

  it("deals at once when everybody still here is ready, rather than waiting out the countdown on a player who left", () => {
    const game = deathRollAdapter({ roll: () => 500, countdownMs: 20_000 });
    const table = seated(game, "ada", "bob", "cat");

    table.disconnect("cat");

    const pause = game.pause?.(table);
    expect(pause).toMatchObject({ key: "deal", ms: 0 });
    pause?.run();
    expect(table.takePending()).toEqual(["ada", "bob"]);
  });

  it("still runs a countdown if a player who left comes back before the deal", () => {
    // Guards the change above: with the leaver no longer counted, nothing is
    // counting down, so their return has to start one or the table stalls.
    const game = deathRollAdapter({ roll: () => 500, countdownMs: 20_000 });
    const table = game.create("ABCDE", { buyIn: 500, maxSeats: 6 }) as Table;
    for (const name of ["ada", "bob", "cat"]) {
      table.join(name, name, who(`u-${name}`));
    }
    table.disconnect("cat");
    // Everybody present is ready, so no countdown starts while cat is away.
    table.setReady("ada", true, Date.now());
    table.setReady("bob", true, Date.now());

    table.reconnect("cat");

    expect(game.pause?.(table)?.key).toBe("countdown");
  });

  it("asks for nobody once the countdown ends, if a disconnect leaves fewer than two still ready", () => {
    const game = deathRollAdapter({ roll: () => 500, countdownMs: 20_000 });
    const table = game.create("ABCDE", { buyIn: 500, maxSeats: 6 }) as Table;
    for (const name of ["ada", "bob", "cat"]) {
      table.join(name, name, who(`u-${name}`));
    }
    table.setReady("ada", true, 0);
    table.setReady("bob", true, 0);

    table.disconnect("bob");
    table.askForGame(20_000);

    expect(table.pending).toBe(false);
  });
});

describe("passing", () => {
  it("takes the price and adds it to the pot", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps, took } = spy();
    await deal(game, table, deps);
    took.mockClear();

    await game.act(table, "ada", { type: "pass" }, deps);

    expect(took).toHaveBeenCalledWith("u-ada", 50);
    expect(table.view(null).pot).toBe(1_050);
  });

  it("refuses a roll that was passed to you", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob", "cat");
    const { deps } = spy();
    await deal(game, table, deps);
    await game.act(table, "ada", { type: "pass" }, deps);

    await expect(game.act(table, "bob", { type: "pass" }, deps)).rejects.toThrow(TableError);
  });

  it("refuses a pass the player cannot pay for, with the pass still in hand", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();
    await deal(game, table, deps);
    const broke = spy(async () => false);

    await expect(game.act(table, "ada", { type: "pass" }, broke.deps)).rejects.toThrow(TableError);

    expect(table.game?.round.holdsPass("ada")).toBe(true);
    expect(table.view(null).pot).toBe(1_000);
  });

  it("hands the price back if the table moved while it was being taken", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();
    await deal(game, table, deps);
    const moving = spy(async () => {
      game.timeout?.(table, "ada");
      return true;
    });

    await expect(game.act(table, "ada", { type: "pass" }, moving.deps)).rejects.toThrow(TableError);

    expect(moving.gave).toHaveBeenCalledWith("u-ada", 50);
    expect(table.view(null).pot).toBe(1_000);
  });
});

describe("settling", () => {
  it("pays the last one standing the whole pot, passes from every round included", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, took, gave, finished } = spy();
    await deal(game, table, deps);

    await game.act(table, "ada", { type: "pass" }, deps);
    await game.act(table, "bob", { type: "roll" }, deps);
    table.nextRound();
    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    await game.settle(table, deps);

    expect(sum(gave.mock.calls)).toBe(sum(took.mock.calls));
    expect(sum(gave.mock.calls)).toBe(1_550);
    const record = finished.mock.calls[0]?.[0] as { players: { net: number }[] };
    expect(record.players.reduce((total, one) => total + one.net, 0)).toBe(0);

    // A whole game is one round on the board for each player, however many
    // rounds of the number it took, and exactly one of them won it.
    const shared = (deps.record as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]?.shared);
    expect(shared.map((one) => one?.rounds)).toEqual([1, 1, 1]);
    expect(shared.filter((one) => one?.roundsWon === 1)).toHaveLength(1);
  });

  it("records no game and no stats as though the pot were paid, when paying the winner fails", async () => {
    const game = deathRollAdapter({ roll: () => 1 });
    const table = seated(game, "ada", "bob");
    const record = vi.fn(async () => {});
    const finished = vi.fn(async () => {});
    const deps = {
      take: vi.fn(async () => true),
      give: vi.fn(async () => {
        throw new Error("store down");
      }),
      record,
      finished,
    } as unknown as GameDeps;
    await deal(game, table, deps);
    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);
    expect(game.isSettled(table)).toBe(true);

    await expect(game.settle(table, deps)).rejects.toThrow("store down");

    expect(record).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  });

  it("never touches an account at a table playing for nothing, over a whole game", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = game.create("ABCDE", { forFun: true, buyIn: 500, maxSeats: 6 }) as Table;
    for (const name of ["ada", "bob", "cat"]) {
      table.join(name, name, null);
      table.setReady(name, true, 0);
    }
    const { deps, took, gave, finished } = spy();

    await deal(game, table, deps);
    await game.act(table, "ada", { type: "roll" }, deps);
    table.nextRound();
    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);
    await game.settle(table, deps);

    expect(took).not.toHaveBeenCalled();
    expect(gave).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    const purses = ["ada", "bob", "cat"].map((name) => table.purseFor(name));
    expect(purses.reduce((a, b) => a + b, 0)).toBe(30_000);
  });

  it("pays the winner in full even though they called to leave mid-game, and drops their seat only once the felt clears", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = seated(game, "ada", "bob", "cat");
    const { deps, gave } = spy();
    await deal(game, table, deps);

    await game.act(table, "ada", { type: "pass" }, deps);
    await game.act(table, "bob", { type: "roll" }, deps);
    table.nextRound();
    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);

    expect(game.isSettled(table)).toBe(true);
    const winnerId = table.game?.winnerId as string;
    const pot = table.view(null).pot;

    table.removeSeat(winnerId);
    expect(table.seats.map((seat) => seat.id)).toContain(winnerId);

    await game.settle(table, deps);

    expect(table.seats.map((seat) => seat.id)).toContain(winnerId);
    expect(gave).toHaveBeenCalledWith(`u-${winnerId}`, pot);

    table.finish();
    expect(table.seats.map((seat) => seat.id)).not.toContain(winnerId);
  });
});

describe("the clock", () => {
  it("rolls for a player whose time ran out, even one who could have passed", async () => {
    const game = deathRollAdapter({ roll: () => 400 });
    const table = seated(game, "ada", "bob");
    const { deps } = spy();
    await deal(game, table, deps);

    game.timeout?.(table, "ada");

    expect(table.view(null).ceiling).toBe(400);
    expect(table.game?.round.holdsPass("ada")).toBe(true);
  });

  it("deals at once when everybody is ready", () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = seated(game, "ada", "bob");

    expect(game.pause?.(table)).toMatchObject({ key: "deal", ms: 0 });
  });

  it("keeps the countdown's key even after it has run out, so the room still runs it", () => {
    /*
     * The room only runs a pause if the table is still waiting on the same key
     * when the timer fires. A countdown that became "deal" at that instant
     * would never be run, and the table would sit there with people ready.
     */
    vi.useFakeTimers();
    try {
      const game = deathRollAdapter({ roll: () => 500, countdownMs: 20_000 });
      const table = game.create("ABCDE", { buyIn: 500, maxSeats: 6 }) as Table;
      for (const name of ["ada", "bob", "cat"]) {
        table.join(name, name, who(`u-${name}`));
      }
      table.setReady("ada", true, Date.now());
      table.setReady("bob", true, Date.now());

      const armed = game.pause?.(table);
      expect(armed?.key).toBe("countdown");

      vi.advanceTimersByTime(armed?.ms ?? 0);
      const firing = game.pause?.(table);
      expect(firing?.key).toBe("countdown");

      firing?.run();
      expect(table.takePending()).toEqual(["ada", "bob"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows who went out before starting the next round, and leaves a finished game up", async () => {
    const draws = [1, 1];
    const game = deathRollAdapter({ roll: () => draws.shift() as number });
    const table = seated(game, "ada", "bob", "cat");
    const { deps } = spy();
    await deal(game, table, deps);

    await game.act(table, "ada", { type: "roll" }, deps);
    const between = game.pause?.(table);
    expect(between?.key).toBe("round");
    between?.run();

    await game.act(table, table.game?.round.toRoll as string, { type: "roll" }, deps);
    expect(game.pause?.(table)?.key).toBe("result");
  });
});

describe("moves", () => {
  it("takes a ready press between games, and refuses a roll when there is none", async () => {
    const game = deathRollAdapter({ roll: () => 500 });
    const table = game.create("ABCDE", { buyIn: 500 }) as Table;
    table.join("ada", "ada", who("u-ada"));
    const { deps } = spy();

    await game.act(table, "ada", { type: "ready", ready: true }, deps);

    expect(table.readiness.isReady("ada")).toBe(true);
    await expect(game.act(table, "ada", { type: "roll" }, deps)).rejects.toThrow(TableError);
  });
});
