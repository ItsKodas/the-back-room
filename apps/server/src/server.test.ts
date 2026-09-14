import type { AddressInfo } from "node:net";
import type { Die } from "@backroom/rules";
import type { Ack, ClientToServer, RoomView, ServerToClient } from "@backroom/shared";
import type { Socket } from "socket.io-client";
import { io as connect } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackRoomServer } from "./server.js";
import {
  CLIENT_ROUTE,
  createBackRoomServer,
  resolveSessionSecret,
  resolveTrustProxy,
} from "./server.js";

/**
 * These drive the real socket layer with real clients.
 *
 * The room engine is tested directly elsewhere; what is only reachable here is
 * everything between a client and that engine — validation, host checks, the
 * farkle pause, bots, broadcast fan-out and disconnects. Both of the worst
 * bugs this project has had lived at exactly that seam and neither was
 * reachable from a unit test.
 */

type Client = Socket<ServerToClient, ClientToServer> & { latest?: RoomView };

let server: BackRoomServer;
let port: number;
const open: Client[] = [];

/** A roller that hands out scripted rolls in order, then repeats the last. */
function scripted(...rolls: Die[][]) {
  let call = 0;
  return (): Die[] => {
    const next = rolls[Math.min(call, rolls.length - 1)] ?? [1, 1, 1, 1, 1, 1];
    call += 1;
    return next;
  };
}

async function start(roll?: () => Die[]): Promise<void> {
  server = createBackRoomServer({
    roll,
    serveClient: false,
    farklePauseMs: 30,
    botDelayMs: 5,
    reconnectGraceMs: 300,
    emptyRoomTtlMs: 200,
  });
  await new Promise<void>((resolve) => {
    server.http.listen(0, () => resolve());
  });
  port = (server.http.address() as AddressInfo).port;
}

function client(): Promise<Client> {
  return new Promise((resolve) => {
    const socket: Client = connect(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    open.push(socket);
    // Remember the most recent state. Without this every assertion races the
    // broadcast that a create or join triggers immediately.
    socket.on("room:state", (state) => {
      socket.latest = state;
    });
    socket.on("connect", () => resolve(socket));
  });
}

/** Waits until a state arrives that satisfies the predicate, or times out. */
function stateWhere(socket: Client, ok: (state: RoomView) => boolean, ms = 2500): Promise<RoomView> {
  const already = socket.latest;
  if (already !== undefined && ok(already)) {
    return Promise.resolve(already);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("room:state", listener);
      reject(new Error("no matching state in time"));
    }, ms);
    const listener = (state: RoomView) => {
      if (ok(state)) {
        clearTimeout(timer);
        socket.off("room:state", listener);
        resolve(state);
      }
    };
    socket.on("room:state", listener);
  });
}

function create(socket: Client, name: string, ruleset?: string): Promise<Ack> {
  return new Promise((resolve) => socket.emit("lobby:create", { name, ruleset }, resolve));
}

function join(socket: Client, name: string, code: string): Promise<Ack> {
  return new Promise((resolve) => socket.emit("lobby:join", { name, code }, resolve));
}

function nextError(socket: Client): Promise<string> {
  return new Promise((resolve) => socket.once("room:error", resolve));
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  for (const socket of open.splice(0)) {
    socket.close();
  }
  await server.close();
});

describe("opening and joining a table", () => {
  it("gives the host a code and seats them", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }
    expect(ack.code).toHaveLength(5);

    const state = await stateWhere(host, (view) => view.seats.length === 1);
    expect(state.seats[0]?.name).toBe("Ada");
    expect(state.seats[0]?.isHost).toBe(true);
  });

  it("tells both players about the other", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);

    const state = await stateWhere(host, (view) => view.seats.length === 2);
    expect(state.seats.map((seat) => seat.name)).toEqual(["Ada", "Bo"]);
  });

  it("accepts a lower-case code", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    const joined = await join(guest, "Bo", ack.code.toLowerCase());
    expect(joined.ok).toBe(true);
  });

  it("refuses a code that does not exist", async () => {
    const guest = await client();
    const ack = await join(guest, "Bo", "ABCDE");
    expect(ack).toEqual({ ok: false, error: "No table with that code." });
  });
});

describe("rejecting malformed input", () => {
  it("refuses a blank name instead of seating an unnamed player", async () => {
    const host = await client();
    const ack = await create(host, "   ");
    expect(ack.ok).toBe(false);
  });

  it("refuses a name longer than the limit", async () => {
    const host = await client();
    const ack = await create(host, "x".repeat(500));
    expect(ack.ok).toBe(false);
  });

  it("refuses a code of the wrong shape", async () => {
    const guest = await client();
    const ack = await join(guest, "Bo", "nope");
    expect(ack.ok).toBe(false);
  });

  it("survives a toggle with a nonsense index", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");
    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => (view.turn?.dice.length ?? 0) > 0);

    // Deliberately not a number. Before validation this reached the engine.
    (host as unknown as { emit: (event: string, payload: unknown) => void }).emit("game:toggle", {
      index: "banana",
    });
    (host as unknown as { emit: (event: string, payload: unknown) => void }).emit("game:toggle", {
      index: 99,
    });

    // The server is still answering, which is the whole point.
    host.emit("game:action", { type: "roll" });
    const state = await stateWhere(host, (view) => (view.turn?.rollSeq ?? 0) >= 1);
    expect(state.status).toBe("playing");
  });
});

describe("host-only controls", () => {
  it("stops a guest starting the game", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);

    const complaint = nextError(guest);
    guest.emit("game:action", { type: "start" });
    expect(await complaint).toMatch(/host/i);
  });

  it("stops a guest adding a bot", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);

    const complaint = nextError(guest);
    guest.emit("lobby:addBot", { skill: "normal" });
    expect(await complaint).toMatch(/host/i);
  });

  it("lets the host change the rules, and everyone sees it", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    host.emit("lobby:setRules", { targetScore: 4000, entryThreshold: 0 });
    const state = await stateWhere(host, (view) => view.ruleset.targetScore === 4000);
    expect(state.ruleset.entryThreshold).toBe(0);
  });

  it("refuses a rule change outside its bounds", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const before = await stateWhere(host, (view) => view.seats.length === 1);
    host.emit("lobby:setRules", { targetScore: 999_999_999 });
    // Nothing should move; give it a moment to prove nothing does.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(before.ruleset.targetScore).toBe(10_000);
  });
});

describe("playing a turn", () => {
  it("carries a whole turn from roll to bank", async () => {
    await server.close();
    // Three 1s, then whatever: 1,000 clears the 500 threshold.
    await start(scripted([1, 1, 1, 2, 3, 4]));

    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");

    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => (view.turn?.dice.length ?? 0) === 6);

    host.emit("game:action", { type: "toggle", index: 0 });
    host.emit("game:action", { type: "toggle", index: 1 });
    const picked = await stateWhere(host, (view) => (view.turn?.selection ?? 0) === 200);
    expect(picked.turn?.selectionValid).toBe(true);

    host.emit("game:action", { type: "toggle", index: 2 });
    await stateWhere(host, (view) => (view.turn?.selection ?? 0) === 1000);

    host.emit("game:action", { type: "bank" });
    const banked = await stateWhere(host, (view) => (view.seats[0]?.score ?? 0) === 1000);
    expect(banked.seats[0]?.onBoard).toBe(true);
  });

  it("refuses a bank under the entry threshold, with a reason", async () => {
    await server.close();
    await start(scripted([1, 2, 3, 4, 6, 6]));

    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");
    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => (view.turn?.dice.length ?? 0) === 6);
    host.emit("game:action", { type: "toggle", index: 0 });
    await stateWhere(host, (view) => (view.turn?.selection ?? 0) === 100);

    const complaint = nextError(host);
    host.emit("game:action", { type: "bank" });
    expect(await complaint).toMatch(/on the board/i);
  });

  it("moves play on by itself after a farkle", async () => {
    await server.close();
    // Ada rolls nothing at all.
    await start(scripted([2, 3, 4, 6, 6, 4]));

    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");

    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => view.turn?.phase === "farkled");
    // The pause is the server's job; nobody has to click anything.
    const passed = await stateWhere(host, (view) => view.turn?.seatId === view.seats[1]?.id);
    expect(passed.turn?.phase).toBe("awaiting_roll");
  });
});

describe("bots", () => {
  it("take their own turn without anyone touching them", async () => {
    await server.close();
    await start(scripted([1, 1, 1, 2, 3, 4]));

    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    host.emit("lobby:addBot", { skill: "normal" });
    await stateWhere(host, (view) => view.seats.length === 2);
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");

    // Ada banks, then the bot plays unaided.
    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => (view.turn?.dice.length ?? 0) === 6);
    host.emit("game:action", { type: "toggle", index: 0 });
    host.emit("game:action", { type: "toggle", index: 1 });
    host.emit("game:action", { type: "toggle", index: 2 });
    await stateWhere(host, (view) => (view.turn?.selection ?? 0) === 1000);
    host.emit("game:action", { type: "bank" });

    const botScored = await stateWhere(
      host,
      (view) => (view.seats[1]?.score ?? 0) > 0 || view.seats[1]?.onBoard === true,
    );
    expect(botScored.seats[1]?.isBot).toBe(true);
  });

  it("do not freeze the table when they farkle", async () => {
    await server.close();
    // Every roll scores nothing, so the bot must farkle and hand back.
    await start(scripted([2, 3, 4, 6, 6, 4]));

    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    host.emit("lobby:addBot", { skill: "normal" });
    await stateWhere(host, (view) => view.seats.length === 2);
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");

    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (view) => view.turn?.seatId === view.seats[1]?.id);
    // The bot farkles too; play must come back to Ada rather than stalling.
    const back = await stateWhere(host, (view) => view.turn?.seatId === view.seats[0]?.id);
    expect(back.status).toBe("playing");
  });
});

describe("leaving and coming back", () => {
  it("gives up the seat at once on a deliberate leave", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    guest.emit("lobby:leave");
    const alone = await stateWhere(host, (view) => view.seats.length === 1);
    expect(alone.seats[0]?.name).toBe("Ada");
  });

  it("holds a seat through a drop and hands it back on resume", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    const joined = await join(guest, "Bo", ack.code);
    if (!joined.ok) {
      throw new Error("join failed");
    }
    await stateWhere(host, (view) => view.seats.length === 2);

    guest.close();
    await stateWhere(host, (view) => view.seats[1]?.connected === false);

    const again = await client();
    const resumed = await new Promise<Ack>((resolve) =>
      again.emit("lobby:resume", { seatId: joined.seatId, code: ack.code }, resolve),
    );
    expect(resumed.ok).toBe(true);
    const back = await stateWhere(host, (view) => view.seats[1]?.connected === true);
    expect(back.seats).toHaveLength(2);
  });

  it("does not end a game just because everyone dropped at once", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (view) => view.status === "playing");

    host.close();
    guest.close();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const seated = server.rooms.get(ack.code);
    expect(seated?.table.status).toBe("playing");
    // Nobody has won: a table everyone dropped from is paused, not decided.
    const table = seated?.table as { winnerIds?: string[] } | undefined;
    expect(table?.winnerIds).toEqual([]);
  });
});

describe("chat", () => {
  it("reaches everyone at the table", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const guest = await client();
    await join(guest, "Bo", ack.code);
    await stateWhere(host, (view) => view.seats.length === 2);

    const heard = new Promise<{ name: string; text: string }>((resolve) =>
      host.once("chat:message", resolve),
    );
    guest.emit("chat:send", { text: "your roll" });
    const message = await heard;
    expect(message.name).toBe("Bo");
    expect(message.text).toBe("your roll");
  });

  it("drops an empty message rather than broadcasting it", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    let heard = false;
    host.on("chat:message", () => {
      heard = true;
    });
    host.emit("chat:send", { text: "   " });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(heard).toBe(false);
  });

  it("throttles someone flooding the table", async () => {
    const host = await client();
    const ack = await create(host, "Ada");
    if (!ack.ok) {
      throw new Error("create failed");
    }
    const complaint = nextError(host);
    for (let index = 0; index < 12; index += 1) {
      host.emit("chat:send", { text: `spam ${index}` });
    }
    expect(await complaint).toMatch(/chat/i);
  });
});

describe("the session secret", () => {
  const was = process.env["NODE_ENV"];
  afterEach(() => {
    process.env["NODE_ENV"] = was;
  });

  it("uses a real secret when one is given", () => {
    process.env["NODE_ENV"] = "production";
    expect(resolveSessionSecret("a-real-secret")).toBe("a-real-secret");
  });

  it("falls back to the development default off production", () => {
    process.env["NODE_ENV"] = "development";
    expect(resolveSessionSecret(undefined)).toBe("back-room-development-secret");
  });

  it("refuses to start in production without one", () => {
    process.env["NODE_ENV"] = "production";
    // The default is published in this repository, so signing production
    // cookies with it would let anyone forge a session.
    expect(() => resolveSessionSecret(undefined)).toThrow(/SESSION_SECRET/);
    expect(() => resolveSessionSecret("")).toThrow(/SESSION_SECRET/);
  });
});

describe("how much of a proxy to believe", () => {
  const was = process.env["NODE_ENV"];
  afterEach(() => {
    process.env["NODE_ENV"] = was;
  });

  it("trusts one proxy in production when nothing is configured", () => {
    process.env["NODE_ENV"] = "production";
    expect(resolveTrustProxy(undefined)).toBe(1);
  });

  it("treats an empty string as unset", () => {
    process.env["NODE_ENV"] = "production";
    // Compose writes ${VAR:-} for anything missing from .env, so "not set"
    // reaches a container as "" rather than undefined. A ?? here reads
    // correctly and never fires, which cost a working sign-in once already.
    expect(resolveTrustProxy("")).toBe(1);
    expect(resolveTrustProxy("   ")).toBe(1);
  });

  it("trusts nothing in development", () => {
    process.env["NODE_ENV"] = "development";
    expect(resolveTrustProxy(undefined)).toBeNull();
    expect(resolveTrustProxy("")).toBeNull();
  });

  it("takes a hop count, a boolean or an address", () => {
    expect(resolveTrustProxy("2")).toBe(2);
    expect(resolveTrustProxy("true")).toBe(true);
    expect(resolveTrustProxy("false")).toBe(false);
    expect(resolveTrustProxy("loopback")).toBe("loopback");
    expect(resolveTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });
});

describe("who gets told what", () => {
  /*
   * The table is sent to each socket separately rather than to the room as a
   * whole, so that a game with something face down can answer each seat
   * differently. The risk in that change is silent: a loop that misses a
   * socket looks exactly like a working table until somebody stops updating.
   */
  it("reaches every seat at the table", async () => {
    await start(() => [1, 2, 3, 4, 5, 6] as Die[]);

    const host = await client();
    const created = await create(host, "Ada");
    const code = created.ok ? created.code : "";

    const guest = await client();
    await join(guest, "Bo", code);

    const third = await client();
    await join(third, "Cass", code);

    // One action, and every socket at the table must hear about it.
    const heard = [host, guest, third].map((socket) =>
      stateWhere(socket, (state) => state.seats.length === 3),
    );
    host.emit("lobby:setRules", { targetScore: 5000 });
    const views = await Promise.all(heard);

    expect(views).toHaveLength(3);
    for (const view of views) {
      expect(view.seats).toHaveLength(3);
    }
  });

  it("tells each seat about itself", async () => {
    await start();
    const host = await client();
    const created = await create(host, "Ada");
    const code = created.ok ? created.code : "";
    const guest = await client();
    const joined = await join(guest, "Bo", code);

    const hostView = await stateWhere(host, (state) => state.seats.length === 2);
    const guestView = await stateWhere(guest, (state) => state.seats.length === 2);

    // Same table, and each socket holds the seat it was given.
    expect(hostView.code).toBe(guestView.code);
    expect(created.ok && joined.ok && created.seatId !== joined.seatId).toBe(true);
  });
});

describe("playing again at the same table", () => {
  it("returns the table to its lobby with the seat still in it", async () => {
    // Six ones is 8,000, so one banked turn wins against a 2,000 target.
    await start(() => [1, 1, 1, 1, 1, 1] as Die[]);
    const host = await client();
    const created = await create(host, "Ada");
    const code = created.ok ? created.code : "";

    host.emit("lobby:setRules", { targetScore: 2000 });
    await stateWhere(host, (state) => state.ruleset.targetScore === 2000);

    host.emit("game:action", { type: "start" });
    await stateWhere(host, (state) => state.status === "playing");
    host.emit("game:action", { type: "roll" });
    await stateWhere(host, (state) => (state.turn?.dice.length ?? 0) === 6);
    for (let index = 0; index < 6; index += 1) {
      host.emit("game:action", { type: "toggle", index });
    }
    await stateWhere(host, (state) => (state.turn?.selection ?? 0) > 0);
    host.emit("game:action", { type: "bank" });
    const over = await stateWhere(host, (state) => state.status === "over");
    expect(over.seats[0]?.score).toBeGreaterThanOrEqual(2000);

    host.emit("game:action", { type: "playAgain" });
    const again = await stateWhere(host, (state) => state.status === "lobby");

    // Same table, same seat, scores wiped, ready to be dealt again.
    expect(again.code).toBe(code);
    expect(again.seats).toHaveLength(1);
    expect(again.seats[0]?.name).toBe("Ada");
    expect(again.seats[0]?.score).toBe(0);
    expect(again.turn).toBeNull();
    expect(again.ruleset.targetScore).toBe(2000);

    // And it can actually be dealt again.
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (state) => state.status === "playing");
  });

  it("will not deal another game while one is running", async () => {
    await start(() => [1, 1, 1, 1, 1, 1] as Die[]);
    const host = await client();
    await create(host, "Ada");
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (state) => state.status === "playing");

    const complaint = nextError(host);
    host.emit("game:action", { type: "playAgain" });
    expect(await complaint).toMatch(/still going/i);
  });
});

describe("watching a table", () => {
  it("shows the table without giving out a seat", async () => {
    await start(() => [1, 2, 3, 4, 5, 6] as Die[]);
    const host = await client();
    const created = await create(host, "Ada");
    const code = created.ok ? created.code : "";

    const watcher = await client();
    const result = await new Promise<Ack>((resolve) =>
      watcher.emit("lobby:watch", { code }, resolve),
    );
    expect(result.ok).toBe(true);

    // They see the table, and the table knows they are there.
    const seen = await stateWhere(watcher, (state) => state.watching === 1);
    expect(seen.code).toBe(code);
    expect(seen.seats).toHaveLength(1);
    expect(await stateWhere(host, (state) => state.watching === 1)).toBeTruthy();
  });

  it("will not let a watcher play", async () => {
    await start(() => [1, 2, 3, 4, 5, 6] as Die[]);
    const host = await client();
    const created = await create(host, "Ada");
    const code = created.ok ? created.code : "";
    host.emit("game:action", { type: "start" });
    await stateWhere(host, (state) => state.status === "playing");

    const watcher = await client();
    await new Promise((resolve) => watcher.emit("lobby:watch", { code }, resolve));

    const complaint = nextError(watcher);
    watcher.emit("game:action", { type: "roll" });
    expect(await complaint).toMatch(/watching/i);
  });

  it("stops counting them when they go", async () => {
    await start(() => [1, 2, 3, 4, 5, 6] as Die[]);
    const host = await client();
    const created = await create(host, "Ada");
    const code = created.ok ? created.code : "";

    const watcher = await client();
    await new Promise((resolve) => watcher.emit("lobby:watch", { code }, resolve));
    await stateWhere(host, (state) => state.watching === 1);

    watcher.emit("lobby:leave");
    expect(await stateWhere(host, (state) => state.watching === 0)).toBeTruthy();
  });
});

describe("tables anybody can walk up to", () => {
  /** Opens a table, saying whether it should be advertised. */
  function open_(socket: Client, name: string, listed?: boolean): Promise<Ack> {
    return new Promise((resolve) =>
      socket.emit("lobby:create", { name, ...(listed === undefined ? {} : { listed }) }, resolve),
    );
  }

  async function listed(query = ""): Promise<Array<Record<string, unknown>>> {
    const port = (server as BackRoomServer).http.address() as AddressInfo;
    const body = (await (
      await fetch(`http://localhost:${port.port}/api/tables${query}`)
    ).json()) as { tables: Array<Record<string, unknown>> };
    return body.tables;
  }

  it("advertises a new table without being asked", async () => {
    const host = await client();
    const ack = await open_(host, "Ada");
    expect(ack.ok).toBe(true);
    await stateWhere(host, (room) => room.seats.length === 1);

    const tables = await listed();
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      game: "greed",
      host: "Ada",
      seats: 1,
      // The table's own limit, not the game's ceiling: a host who wanted a
      // smaller table should be advertising the table they actually opened.
      maxSeats: 10,
      status: "lobby",
    });
  });

  it("keeps a private table off the list, code and all", async () => {
    const host = await client();
    const ack = await open_(host, "Ada", false);
    expect(ack.ok).toBe(true);
    await stateWhere(host, (room) => room.seats.length === 1);

    expect(await listed()).toEqual([]);
    // Still perfectly playable — private is about being found, not about being
    // reachable, so the code somebody was given still works.
    const guest = await client();
    const joined = await join(guest, "Bram", ack.ok ? ack.code : "");
    expect(joined.ok).toBe(true);
  });

  it("lets the host change their mind, both ways", async () => {
    const host = await client();
    await open_(host, "Ada");
    await stateWhere(host, (room) => room.seats.length === 1);

    host.emit("lobby:setListed", { listed: false });
    await expect.poll(async () => (await listed()).length).toBe(0);

    host.emit("lobby:setListed", { listed: true });
    await expect.poll(async () => (await listed()).length).toBe(1);
  });

  it("is the host's call and nobody else's", async () => {
    const host = await client();
    const ack = await open_(host, "Ada");
    const guest = await client();
    await join(guest, "Bram", ack.ok ? ack.code : "");

    const refused = nextError(guest);
    guest.emit("lobby:setListed", { listed: false });
    expect(await refused).toMatch(/host/i);
    // And it did not happen anyway.
    expect(await listed()).toHaveLength(1);
  });

  it("shows only the game that was asked for", async () => {
    const host = await client();
    await open_(host, "Ada");
    await stateWhere(host, (room) => room.seats.length === 1);

    expect(await listed("?game=greed")).toHaveLength(1);
    expect(await listed("?game=blackjack")).toEqual([]);
    expect(await listed("?game=nonsense")).toEqual([]);
  });

  it("gives away nothing about the play", async () => {
    /*
     * The whole reason a table's state is built per seat is that it is not
     * something to hand to people who have no seat at it. This list is read by
     * anybody, signed in or not, so it must never grow a field that carries
     * the game — a hand of cards least of all.
     */
    const host = await client();
    await open_(host, "Ada");
    await stateWhere(host, (room) => room.seats.length === 1);

    const [table] = await listed();
    expect(Object.keys(table ?? {}).sort()).toEqual([
      "code",
      "game",
      "host",
      "maxSeats",
      "seats",
      "status",
      "watching",
    ]);
  });

  it("stops advertising a table everybody walked away from", async () => {
    /*
     * Closing the tab, not pressing Leave — the way most tables are actually
     * abandoned, and the way that leaves a seat behind rather than giving it
     * up. It works because "empty" means every seat disconnected rather than
     * no seats at all, so the sweep run when the socket drops already counts
     * the table as gone and books its removal.
     *
     * Pinned because a public list is what makes it matter. A table that
     * outlives everybody at it used to be invisible unless you had its code;
     * now it would sit on the front page inviting people into an empty room.
     */
    const host = await client();
    await open_(host, "Ada");
    await stateWhere(host, (room) => room.seats.length === 1);
    expect(await listed()).toHaveLength(1);

    host.close();

    // Two separate things, and they happen at two separate times: it stops
    // being advertised the moment the last person goes, and the table itself
    // is swept up later, once the grace for coming back has run out.
    await expect.poll(async () => (await listed()).length, { timeout: 4000 }).toBe(0);
    await expect
      .poll(() => (server as BackRoomServer).rooms.size, { timeout: 4000 })
      .toBe(0);
  });

  it("never advertises a table with nobody at it", async () => {
    /*
     * An abandoned table lingers for a few minutes so a refresh can get back
     * into it. That grace is worth having and is not worth advertising: a row
     * offering a seat at an empty room, hosted by nobody, is worse than no row.
     */
    const host = await client();
    await open_(host, "Ada");
    await stateWhere(host, (room) => room.seats.length === 1);
    expect(await listed()).toHaveLength(1);

    const code = host.latest?.code ?? "";
    host.emit("lobby:leave");
    await expect.poll(async () => (await listed()).length).toBe(0);
    // Off the board at once, but still there to come back to for a while.
    expect((server as BackRoomServer).rooms.has(code)).toBe(true);
  });

  it("does not advertise a table left to its bots", async () => {
    /*
     * A bot is connected from the moment it is seated and never drops, so a
     * table whose last player walked out looks occupied forever. It is not: a
     * table is empty when the last person leaves it.
     */
    const host = await client();
    await open_(host, "Ada");
    await stateWhere(host, (room) => room.seats.length === 1);
    host.emit("lobby:addBot", { skill: "normal" });
    await stateWhere(host, (room) => room.seats.length === 2);
    expect(await listed()).toHaveLength(1);

    host.emit("lobby:leave");
    await expect.poll(async () => (await listed()).length).toBe(0);
  });

  it("puts the emptiest tables first", async () => {
    const busy = await client();
    const busyAck = await open_(busy, "Ada");
    const second = await client();
    await join(second, "Bram", busyAck.ok ? busyAck.code : "");

    const quiet = await client();
    await open_(quiet, "Cleo");
    await stateWhere(quiet, (room) => room.seats.length === 1);

    const tables = await listed();
    expect(tables.map((table) => table["seats"])).toEqual([1, 2]);
  });
});

describe("what the room offers", () => {
  it("lists every game, and says which can be opened", async () => {
    await start();
    const port = (server as BackRoomServer).http.address() as AddressInfo;
    const body = (await (await fetch(`http://localhost:${port.port}/api/room`)).json()) as {
      games: Array<{ id: string; open: boolean; shape: string; tables: number }>;
    };

    const ids = body.games.map((game) => game.id);
    expect(ids).toContain("greed");
    expect(body.games.find((game) => game.id === "greed")?.open).toBe(true);
    expect(body.games.find((game) => game.id === "blackjack")?.open).toBe(true);
    expect(body.games.find((game) => game.id === "slots")?.open).toBe(true);
    // A machine is not a table, and says so.
    expect(body.games.find((game) => game.id === "slots")?.shape).toBe("machine");
  });

  it("counts the tables people are actually at", async () => {
    await start();
    const port = (server as BackRoomServer).http.address() as AddressInfo;
    const host = await client();
    await create(host, "Ada");
    await stateWhere(host, (state) => state.seats.length === 1);

    const body = (await (await fetch(`http://localhost:${port.port}/api/room`)).json()) as {
      games: Array<{ id: string; tables: number; seated: number }>;
    };
    const greed = body.games.find((game) => game.id === "greed");
    expect(greed?.tables).toBe(1);
    expect(greed?.seated).toBe(1);
  });

  it("no longer offers a daily top-up", async () => {
    await start();
    const port = (server as BackRoomServer).http.address() as AddressInfo;
    const response = await fetch(`http://localhost:${port.port}/api/daily`, { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("what a link to this place looks like", () => {
  /** The port the running server is on, which every request here needs. */
  function at(path: string): string {
    const address = (server as BackRoomServer).http.address() as AddressInfo;
    return `http://localhost:${address.port}${path}`;
  }

  it("draws a card for the room", async () => {
    await start();
    const response = await fetch(at("/og/site.png"));

    expect(response.headers.get("content-type")).toContain("image/png");
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it("draws a card for a table somebody is actually at", async () => {
    await start();
    const host = await client();
    const code = await create(host, "Ada");
    await stateWhere(host, (state) => state.seats.length === 1);

    const response = await fetch(at(`/og/table/${code}.png`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });

  it("still draws something for a code that is nobody's table", async () => {
    /*
     * A link outlives the table it points at, and the moment somebody follows
     * a dead one is exactly the moment an unfurler asks for the picture. It
     * gets the room's own rather than a broken image.
     */
    await start();
    const response = await fetch(at("/og/table/ZZZZZ.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });

  it("tells crawlers where the map is, and which doors are not for them", async () => {
    await start();
    const body = await (await fetch(at("/robots.txt"))).text();

    expect(body).toContain("Disallow: /me$");
    expect(body).toContain("Disallow: /admin$");
    expect(body).toMatch(/Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
  });

  it("shuts the crawler out of those pages and not out of the tables", async () => {
    /*
     * A Disallow is a prefix match, so an unanchored "/me" is also every
     * address beginning with those two letters — and the codes handed out at
     * the root are five letters of the alphabet. `TableLink` uppercases
     * whatever it is given, so /megan is a working link to table MEGAN, and
     * an unanchored rule shut a crawler out of it. A link to a table is the
     * most shared thing here.
     *
     * Read back off the wire and applied the way a crawler would, rather than
     * asserted against a list this test also writes.
     */
    await start();
    const body = await (await fetch(at("/robots.txt"))).text();
    const rules = [...body.matchAll(/^Disallow: (\S+)$/gm)].map((found) => found[1] ?? "");

    expect(rules.length).toBeGreaterThan(0);
    /** Whether a crawler reading these rules would be kept off an address. */
    const blocked = (path: string): boolean =>
      rules.some((rule) =>
        rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule),
      );

    expect(blocked("/me")).toBe(true);
    expect(blocked("/admin")).toBe(true);
    expect(blocked("/api/games")).toBe(true);
    // The ones that must stay reachable: a table code that happens to begin
    // with the same letters, and every game's own page.
    expect(blocked("/megan")).toBe(false);
    expect(blocked("/MEGAN")).toBe(false);
    expect(blocked("/admit")).toBe(false);
    expect(blocked("/stylo")).toBe(false);
    expect(blocked("/blackjack")).toBe(false);
    expect(blocked("/")).toBe(false);
  });

  it("lists the games on the map and none of the tables", async () => {
    await start();
    const host = await client();
    const code = await create(host, "Ada");
    await stateWhere(host, (state) => state.seats.length === 1);

    const body = await (await fetch(at("/sitemap.xml"))).text();

    expect(body).toContain("<loc>http://localhost");
    // Every game somebody can actually sit down at, and nothing else. Written
    // against the catalogue rather than a hand-listed set, so a game added
    // later is either on the map or fails here — the previous version of this
    // named the one game that happened to be unopenable at the time, and went
    // stale the moment it opened.
    for (const game of ["greed", "blackjack", "slots"]) {
      expect(body).toContain(`/${game}</loc>`);
    }
    // A table is a room that will not exist next week.
    expect(body).not.toContain(code);
  });
});

describe("which addresses belong to the client", () => {
  /*
   * A negative match, and those fail quietly. Getting this wrong answers an
   * API request with the HTML page — which a browser renders happily, and no
   * test that talks over the socket would ever see.
   */
  it("keeps its hands off everything the server answers", () => {
    for (const path of [
      "/api/room",
      "/api/table/6PMKG",
      "/auth/discord",
      "/healthz",
      "/og/site.png",
      "/og/table/6PMKG.png",
      "/socket.io/?EIO=4",
    ]) {
      expect(CLIENT_ROUTE.test(path)).toBe(false);
    }
  });

  it("takes every address the app actually has", () => {
    for (const path of ["/", "/blackjack", "/blackjack/6PMKG", "/6PMKG", "/me", "/admin"]) {
      expect(CLIENT_ROUTE.test(path)).toBe(true);
    }
  });

  it("does not mistake a table code for a service path", () => {
    // The boundary is the point: /api is the server's, /apiary is a page.
    expect(CLIENT_ROUTE.test("/apiary")).toBe(true);
    expect(CLIENT_ROUTE.test("/ogre")).toBe(true);
  });
});

describe("somebody who walks away without saying so", () => {
  it("keeps their seat for a moment, so a refresh can reclaim it", async () => {
    await start();
    const host = await client();
    const ack = await create(host, "Ada");
    const guest = await client();
    await join(guest, "Bo", (ack as { code: string }).code);
    await stateWhere(host, (state) => state.seats.length === 2);

    guest.close();

    // Marked gone at once, so the table can say what happened rather than
    // pretending they are still there deciding.
    const gone = await stateWhere(host, (state) =>
      state.seats.some((seat) => seat.name === "Bo" && !seat.connected),
    );
    expect(gone.seats).toHaveLength(2);
  });

  it("gives the seat up once they have not come back", async () => {
    /*
     * A dropped connection is the ordinary way people leave — a closed laptop,
     * a train tunnel, a phone going to sleep. Holding their seat forever leaves
     * a table that cannot fill and, at a chips table, one that cannot deal for
     * want of a second player who is not actually there.
     *
     * The grace period is 90 seconds in production and 300ms here.
     */
    await start();
    const host = await client();
    const ack = await create(host, "Ada");
    const guest = await client();
    await join(guest, "Bo", (ack as { code: string }).code);
    await stateWhere(host, (state) => state.seats.length === 2);

    guest.close();

    const alone = await stateWhere(host, (state) => state.seats.length === 1, 4000);
    expect(alone.seats[0]?.name).toBe("Ada");
  });

  it("keeps the seat of somebody who comes straight back", async () => {
    await start();
    const host = await client();
    const ack = await create(host, "Ada");
    const code = (ack as { code: string }).code;
    const guest = await client();
    const seated = await join(guest, "Bo", code);
    await stateWhere(host, (state) => state.seats.length === 2);

    guest.close();
    const back = await client();
    await new Promise<void>((resolve) => {
      back.emit("lobby:resume", { seatId: (seated as { seatId: string }).seatId, code }, () =>
        resolve(),
      );
    });

    // Past the grace period, and still two: the timer must not take a seat
    // whose owner has already reclaimed it.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const state = await stateWhere(host, () => true);
    expect(state.seats).toHaveLength(2);
  });
});

