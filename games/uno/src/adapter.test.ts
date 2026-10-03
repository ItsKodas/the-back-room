import type { FinishedGame, GameDeps, StatBumpLike } from "@backroom/core";
import { TableError } from "@backroom/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unoAdapter } from "./adapter.js";
import { decide } from "./bot.js";
import { num, seeded, stage } from "./fixtures.js";
import { FUN_PURSE } from "./listing.js";
import type { Table } from "./table.js";

type Adapter = ReturnType<typeof unoAdapter>;

const store = () => {
  const balances = new Map<string, number>();
  const deps = {
    take: vi.fn(async (userId: string, amount: number) => {
      const had = balances.get(userId) ?? 0;
      if (had < amount) {
        return false;
      }
      balances.set(userId, had - amount);
      return true;
    }),
    give: vi.fn(async (userId: string, amount: number) => {
      balances.set(userId, (balances.get(userId) ?? 0) + amount);
    }),
    record: vi.fn(async (_userId: string, _bump: StatBumpLike) => undefined),
    finished: vi.fn(async (_record: FinishedGame) => undefined),
  } satisfies GameDeps;
  return { balances, deps };
};

const seated = (
  adapter: Adapter,
  names: readonly string[],
  options: { forFun?: boolean; uno?: Record<string, unknown> } = {},
) => {
  const table = adapter.create("ABCDE", {
    buyIn: 500,
    forFun: options.forFun ?? false,
    maxSeats: 10,
    uno: { gameMode: "single", ...options.uno },
  }) as Table;
  for (const name of names) {
    table.join(name, name, options.forFun === true ? null : { userId: name, avatar: null, accentColor: null });
  }
  return table;
};

const deal = async (adapter: Adapter, table: Table, deps: GameDeps, names: readonly string[]) => {
  for (const name of names) {
    table.setReady(name, true, Date.now());
  }
  table.askForGame(Date.now());
  return await adapter.payOut?.(table, deps);
};

/** Has whoever is to act make the move a bot would, through the same messages a browser sends. */
const playOnce = async (adapter: Adapter, table: Table, deps: GameDeps, rng: () => number) => {
  const game = table.game;
  if (game === null || !game.active) return;
  const me = table.seatAt(game.current) as string;
  const choice = decide(game, game.current, "normal", rng);
  if (choice === null) throw new Error(`stuck in ${game.phase}`);
  switch (choice.type) {
    case "play":
      await adapter.act(
        table,
        me,
        {
          type: "play",
          cardId: choice.cardId,
          color: choice.color,
          target: choice.target === undefined ? undefined : table.seatAt(choice.target),
          uno: choice.declareUno,
        },
        deps,
      );
      return;
    case "chooseColor":
      await adapter.act(table, me, { type: "color", color: choice.color }, deps);
      return;
    default:
      await adapter.act(table, me, choice, deps);
  }
};

describe("opening a table", () => {
  it("keeps the host's rules, checked against the game's own list", () => {
    const adapter = unoAdapter();
    const table = adapter.create("ABCDE", {
      uno: { stacking: "mixed", handSize: 400, jumpIn: "yes", madeUp: true, wd4Rule: "never" },
    }) as Table;
    expect(table.rules.stacking).toBe("mixed");
    expect(table.rules.handSize).toBe(12);
    expect(table.rules.jumpIn).toBe(false);
    expect(table.rules.wd4Rule).toBe("challenge");
    expect("madeUp" in table.rules).toBe(false);
  });

  it("names the preset the rules are, or calls them house rules", () => {
    const adapter = unoAdapter();
    expect((adapter.create("ABCDE", {}) as Table).rulesetName).toBe("Official");
    expect((adapter.create("ABCDE", { uno: { rabbids: true } }) as Table).rulesetName).toBe("Rabbids");
    expect((adapter.create("ABCDE", { uno: { rabbids: true, jumpIn: true } }) as Table).rulesetName).toBe(
      "House rules",
    );
  });

  it("refuses a bot at a table playing for chips", () => {
    const table = seated(unoAdapter(), ["a"]);
    expect(() => table.addBot("bot", "Bot", "normal")).toThrow(TableError);
  });
});

describe("the antes and the pot", () => {
  let bank: ReturnType<typeof store>;
  let adapter: Adapter;

  beforeEach(() => {
    bank = store();
    adapter = unoAdapter({ rng: seeded(7) });
  });

  it("deals nobody until the antes are in, then everybody who paid", async () => {
    const table = seated(adapter, ["a", "b", "c"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    bank.balances.set("c", 100);
    expect(await deal(adapter, table, bank.deps, ["a", "b", "c"])).toBe(true);
    expect(table.players).toEqual(["a", "b"]);
    expect(table.view("c").seats.find((seat) => seat.id === "c")?.short).toBe(true);
    expect(table.view(null).pot).toBe(1_000);
    expect(bank.balances.get("a")).toBe(500);
  });

  it("pays the whole pot to the champion and records the game", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    await deal(adapter, table, bank.deps, ["a", "b"]);
    const rng = seeded(3);
    for (let step = 0; step < 3_000 && table.phase === "playing"; step += 1) {
      await playOnce(adapter, table, bank.deps, rng);
    }
    expect(table.phase).toBe("over");
    expect(adapter.isSettled(table)).toBe(true);
    await adapter.settle(table, bank.deps);
    const champion = table.championId as string;
    const other = champion === "a" ? "b" : "a";
    expect(bank.balances.get(champion)).toBe(1_500);
    expect(bank.balances.get(other)).toBe(500);
    const record = bank.deps.finished.mock.calls[0]?.[0];
    expect(record?.winnerIds).toEqual([champion]);
    expect(record?.players.map((one) => one.net).sort()).toEqual([-500, 500]);
  });

  it("hands every ante back when the table is called off mid-game", async () => {
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    await deal(adapter, table, bank.deps, ["a", "b"]);
    await adapter.void(table, bank.deps);
    expect(bank.balances.get("a")).toBe(1_000);
    expect(bank.balances.get("b")).toBe(1_000);
  });
});

describe("what each seat sees", () => {
  it("shows you your own hand and everybody else's only as a count", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(11) });
    const table = seated(adapter, ["a", "b"]);
    bank.balances.set("a", 1_000);
    bank.balances.set("b", 1_000);
    await deal(adapter, table, bank.deps, ["a", "b"]);
    const view = table.view("a");
    const theirs = table.game?.players[1]?.hand.map((one) => one.id) ?? [];
    expect(view.hand?.cards.length).toBe(table.game?.players[0]?.hand.length);
    expect(view.seats.find((seat) => seat.id === "b")?.cards).toBe(theirs.length);
    // Not one of their card ids anywhere in what you are sent: ids are dealt in
    // deck order, so an id is as good as the card's face.
    const sent = JSON.stringify(view);
    for (const id of theirs) {
      expect(sent).not.toMatch(new RegExp(`"id":${id}[,}]`));
    }
    expect(table.view(null).hand).toBe(null);
  });
});

describe("moves out of turn", () => {
  it("lets anybody catch an uncalled UNO, without restarting the clock of whoever is to act", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(5) });
    const table = seated(adapter, ["a", "b", "c"]);
    for (const one of ["a", "b", "c"]) bank.balances.set(one, 1_000);
    await deal(adapter, table, bank.deps, ["a", "b", "c"]);
    const game = table.game;
    if (game === null) throw new Error("no game");
    const last = num("red", 1);
    stage(game, {
      hands: [[last, num("red", 2)], [num("green", 1), num("green", 3)], [num("green", 2), num("blue", 2)]],
      top: num("red", 3),
    });
    await adapter.act(table, "a", { type: "play", cardId: last.id }, bank.deps);
    const endsAt = table.turnEndsAt;
    expect(table.view("c").catchable).toBe("a");
    await adapter.act(table, "c", { type: "catch", seat: "a" }, bank.deps);
    expect(game.players[0]?.hand.length).toBe(3);
    expect(table.turnEndsAt).toBe(endsAt);
  });

  it("refuses a card that is not in your hand, in words", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(5) });
    const table = seated(adapter, ["a", "b"], { forFun: true });
    await deal(adapter, table, bank.deps, ["a", "b"]);
    const me = table.seatAt(table.game?.current ?? 0) as string;
    await expect(adapter.act(table, me, { type: "play", cardId: 99_999 }, bank.deps)).rejects.toThrow(TableError);
  });
});

describe("the clock", () => {
  it("draws for somebody whose time ran out, rather than playing their cards for them", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(9) });
    const table = seated(adapter, ["a", "b"], { forFun: true });
    await deal(adapter, table, bank.deps, ["a", "b"]);
    const game = table.game;
    if (game === null) throw new Error("no game");
    stage(game, { hands: [[num("red", 2), num("red", 4)], [num("green", 1)]], top: num("red", 3) });
    table.turnEndsAt = Date.now() - 1;
    adapter.timeout?.(table, "a");
    expect(game.players[0]?.hand.length).toBeGreaterThanOrEqual(3);
  });

  it("does nothing for a clock that has not run out", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(9) });
    const table = seated(adapter, ["a", "b"], { forFun: true });
    await deal(adapter, table, bank.deps, ["a", "b"]);
    const turn = table.game?.turn;
    adapter.timeout?.(table, table.seatAt(table.game?.current ?? 0) as string);
    expect(table.game?.turn).toBe(turn);
  });

  it("gives a seat that has gone a short clock, so a ghost cannot hold the table", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(9), turnMs: 20_000 });
    const table = seated(adapter, ["a", "b", "c"], { forFun: true });
    await deal(adapter, table, bank.deps, ["a", "b", "c"]);
    const game = table.game;
    if (game === null) throw new Error("no game");
    stage(game, {
      hands: [[num("red", 2), num("red", 4)], [num("red", 1), num("red", 5)], [num("green", 1)]],
      top: num("red", 3),
    });
    table.disconnect("b");
    await adapter.act(table, "a", { type: "play", cardId: game.players[0]?.hand[0]?.id }, bank.deps);
    expect((table.turnEndsAt ?? 0) - Date.now()).toBeLessThanOrEqual(4_000);
  });
});

describe("a table playing for fun", () => {
  it("plays a whole game of bots and one person out, and pays the purse", async () => {
    const bank = store();
    const adapter = unoAdapter({ rng: seeded(21) });
    const table = seated(adapter, ["me"], { forFun: true, uno: { jumpIn: true, sevenO: true } });
    table.addBot("bot1", "Ava", "easy");
    table.addBot("bot2", "Ben", "hard");
    await deal(adapter, table, bank.deps, ["me"]);
    expect(table.players).toHaveLength(3);
    const rng = seeded(4);
    for (let step = 0; step < 5_000 && table.phase === "playing"; step += 1) {
      const bot = adapter.botMove?.(table);
      if (bot !== null && bot !== undefined) {
        bot.play();
        continue;
      }
      await playOnce(adapter, table, bank.deps, rng);
    }
    expect(table.phase).toBe("over");
    await adapter.settle(table, bank.deps);
    const champion = table.championId as string;
    expect(table.purseFor(champion)).toBe(FUN_PURSE + 1_000);
    // Play money is never anybody's account.
    expect(bank.deps.give).not.toHaveBeenCalled();
    expect(bank.deps.finished).not.toHaveBeenCalled();
  });
});
