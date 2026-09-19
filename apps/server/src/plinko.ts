import { BankLedger } from "@backroom/core";
import type { StatBump, Store } from "@backroom/economy";
import {
  FEED_LENGTH,
  FUN_BANK,
  FUN_PURSE,
  MAX_WAITING,
  MIN_STAKE,
  type Risk,
  bucketOf,
  capsFor,
  colourOf,
  drawPath,
  maxStake,
  multOf,
  payout,
  PLINKO,
} from "@backroom/game-plinko";
import type {
  ClientToServer,
  PlinkoCaps,
  PlinkoDrop,
  PlinkoResult,
  PlinkoWatcher,
  ServerToClient,
} from "@backroom/shared";
import { plinkoDropSchema } from "@backroom/shared/schemas";
import type { DefaultEventsMap, Server, Socket } from "socket.io";
import { SOMETHING_WENT_WRONG, acking } from "./handle.js";
import type { SocketIdentity } from "./server.js";

/**
 * The peg board, out here rather than in server.ts.
 *
 * Wired the way the slot machine is — its own events, its own ledger, one ack
 * per ball — but the machine's handlers already make server.ts the longest
 * file in the repo, and nothing about this game needs a table, a room or an
 * adapter. Created once, because the ledger, the feed and who is standing at
 * the board belong to the server, and wired to each socket as it connects.
 */

type PlinkoSocket = Socket<ClientToServer, ServerToClient, DefaultEventsMap, SocketIdentity>;
type PlinkoIo = Server<ClientToServer, ServerToClient, DefaultEventsMap, SocketIdentity>;

export interface PlinkoDeps {
  io: PlinkoIo;
  store: Store;
  take: (userId: string, amount: number) => Promise<boolean>;
  give: (userId: string, amount: number) => Promise<void>;
  record: (userId: string, bump: StatBump) => Promise<void>;
  /** Integers in `[0, 4096)`. `node:crypto` in production; scripted in tests. */
  draw: () => number;
  /** Why the board is shut to everybody right now, or null. */
  refusal: () => string | null;
}

export interface Plinko {
  wire: (socket: PlinkoSocket) => void;
  sign: () => Promise<{ bank: number; caps: PlinkoCaps }>;
  /** An admin's empty, queued behind any ball already under way. */
  empty: () => Promise<number>;
  /** Waits out whatever is in the ledger's queue, for shutdown. */
  settle: () => Promise<void>;
}

/** Everybody standing at the board, whether or not they are dropping. */
const ROOM = "plinko:floor";

export function createPlinko(deps: PlinkoDeps): Plinko {
  const { io, store } = deps;
  /**
   * One paid ball at a time across the whole board. The cap is read off the
   * bank, and two balls that both read it before either stake has landed are
   * each capped as though the other were not there.
   */
  const ledger = new BankLedger();
  /* Atmosphere, not a record: lost on restart, which is right. */
  const recent: PlinkoDrop[] = [];
  /** Drops each account has waiting on the ledger, so one account cannot flood it. */
  const waiting = new Map<string, number>();
  /** Play money lives at the board and goes when the socket does. */
  const fun = new Map<string, { purse: number; bank: number }>();
  /** By socket, so two windows are counted once by account below. */
  const watchers = new Map<string, PlinkoWatcher & { userId: string }>();
  let dropSeq = 0;

  function here(): PlinkoWatcher[] {
    const byAccount = new Map<string, PlinkoWatcher>();
    for (const one of watchers.values()) {
      byAccount.set(one.userId, { name: one.name, colour: one.colour });
    }
    return [...byAccount.values()];
  }

  function tellHere(): void {
    io.to(ROOM).emit("plinko:here", here());
  }

  async function sign(): Promise<{ bank: number; caps: PlinkoCaps }> {
    const bank = await store.bank("plinko");
    return { bank, caps: capsFor(bank) };
  }

  function refusedOver(cap: number, risk: Risk): string {
    return cap < MIN_STAKE
      ? "The bank is empty. Nothing to play for yet."
      : `The bank covers ${cap} a ball on ${risk} at the moment.`;
  }

  /**
   * The same board for nothing: same draw, same cap, same multipliers, against
   * a purse and a bank that were never anybody's. Nothing here reaches the
   * store, the bank, the stats or the floor.
   */
  function dropForFun(socketId: string, stake: number, risk: Risk, ack: (result: PlinkoResult) => void): void {
    const board = fun.get(socketId) ?? { purse: FUN_PURSE, bank: FUN_BANK };
    fun.set(socketId, board);
    const cap = maxStake(board.bank, risk);
    if (stake > cap) {
      ack({ ok: false, error: refusedOver(cap, risk) });
      return;
    }
    if (stake > board.purse) {
      ack({ ok: false, error: "Not enough play money." });
      return;
    }
    board.purse -= stake;
    board.bank += stake;
    const path = drawPath(deps.draw);
    const bucket = bucketOf(path);
    const won = payout(stake, risk, bucket);
    board.bank -= won;
    board.purse += won;
    // Topped back up: losing play money should end a ball, not the evening.
    if (board.purse < MIN_STAKE) {
      board.purse = FUN_PURSE;
    }
    ack({
      ok: true,
      path,
      bucket,
      mult: multOf(risk, bucket),
      stake,
      risk,
      won,
      bank: board.bank,
      caps: capsFor(board.bank),
      balance: board.purse,
    });
  }

  function wire(socket: PlinkoSocket): void {
    socket.on("plinko:watch", (_payload, ack) => {
      void socket.join(ROOM);
      const userId = socket.data.identity?.userId ?? null;
      if (userId !== null) {
        watchers.set(socket.id, { userId, name: socket.data.name ?? "Someone", colour: colourOf(userId) });
      }
      void sign().then(
        ({ bank, caps }) => {
          ack({ recent: recent.slice(0, FEED_LENGTH), here: here(), bank, caps });
          tellHere();
        },
        (error: unknown) => console.error("plinko:watch failed", error),
      );
    });

    const away = () => {
      void socket.leave(ROOM);
      if (watchers.delete(socket.id)) {
        tellHere();
      }
    };
    socket.on("plinko:away", away);
    socket.on("disconnect", () => {
      fun.delete(socket.id);
      away();
    });

    socket.on("plinko:drop", (payload, ack) => {
      acking("plinko:drop", ack, () => ({ ok: false as const, error: SOMETHING_WENT_WRONG }), async (ack) => {
        const parsed = plinkoDropSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: "That is not a stake." });
          return;
        }
        const { stake, risk } = parsed.data;

        // Before sign-in: nobody signs in to play for nothing.
        if (parsed.data.forFun === true) {
          dropForFun(socket.id, stake, risk, ack);
          return;
        }

        const userId = socket.data.identity?.userId ?? null;
        if (userId === null) {
          ack({ ok: false, error: "Sign in to play for chips." });
          return;
        }
        const refusal = deps.refusal();
        if (refusal !== null) {
          ack({ ok: false, error: refusal });
          return;
        }
        const inAir = waiting.get(userId) ?? 0;
        if (inAir >= MAX_WAITING) {
          ack({ ok: false, error: "Too many balls in the air." });
          return;
        }
        waiting.set(userId, inAir + 1);
        try {
          await ledger.serially(async () => {
            /*
             * The order below is the whole safety argument. The stake goes into
             * the bank before the path is drawn, so by the time anything is
             * owed the money to pay it is already there.
             */
            const cap = maxStake(await store.bank("plinko"), risk);
            if (stake > cap) {
              ack({ ok: false, error: refusedOver(cap, risk) });
              return;
            }
            if (!(await deps.take(userId, stake))) {
              ack({ ok: false, error: "Not enough chips." });
              return;
            }
            await store.bankAdd("plinko", stake);

            const path = drawPath(deps.draw);
            const bucket = bucketOf(path);
            const mult = multOf(risk, bucket);
            const won = payout(stake, risk, bucket);

            /*
             * Only if the bank actually has it. The cap makes this unreachable,
             * which is exactly why it is checked: the alternative is a bank that
             * goes negative in silence.
             */
            if (won > 0 && !(await store.bankTake("plinko", won))) {
              await store.bankAdd("plinko", -stake);
              await deps.give(userId, stake);
              ack({ ok: false, error: "The bank is short. Nothing was staked." });
              return;
            }
            if (won > 0) {
              await deps.give(userId, won);
            }

            await deps.record(userId, {
              // Chips and no round, as at the machine: a ball a second is not a contest.
              shared: { chipsWon: won - stake, chipsStaked: stake },
              game: PLINKO.id,
              add: { drops: 1, staked: stake },
              max: { bestDrop: won },
            });

            const bank = await store.bank("plinko");
            dropSeq += 1;
            const news: PlinkoDrop = {
              id: `${socket.id}-${Date.now()}-${dropSeq}`,
              by: { name: socket.data.name ?? "Someone", colour: colourOf(userId) },
              risk,
              path,
              bucket,
              mult,
              stake,
              won,
              bank,
              at: Date.now(),
            };
            recent.unshift(news);
            recent.length = Math.min(recent.length, FEED_LENGTH);
            // Everybody but the dropper: their own ball is already falling on their screen.
            socket.to(ROOM).emit("plinko:dropped", news);

            ack({
              ok: true,
              path,
              bucket,
              mult,
              stake,
              risk,
              won,
              bank,
              caps: capsFor(bank),
              balance: (await store.get(userId))?.chips ?? 0,
            });
          });
        } finally {
          // In a finally so a throw cannot wedge an account out of the board.
          const left = (waiting.get(userId) ?? 1) - 1;
          if (left > 0) {
            waiting.set(userId, left);
          } else {
            waiting.delete(userId);
          }
        }
      });
    });
  }

  return {
    wire,
    sign,
    empty: () => ledger.serially(() => store.bankEmpty("plinko")),
    settle: () => ledger.serially(async () => {}),
  };
}
