import { randomUUID } from "node:crypto";
import type { JarRecord, Store } from "@backroom/economy";
import { emptyJarRecord } from "@backroom/economy";
import type { Jar } from "@backroom/game-tips";
import {
  NIGHT_MS,
  REFUSALS,
  TIPS,
  buy,
  emptyJar,
  levelAt,
  numbersFor,
  tap,
} from "@backroom/game-tips";
import type { ClientToServer, JarView, ServerToClient, TapResult } from "@backroom/shared";
import { buySchema, tapSchema } from "@backroom/shared/schemas";
import type { DefaultEventsMap, Socket } from "socket.io";
import { SOMETHING_WENT_WRONG, acking } from "./handle.js";
import type { SocketIdentity } from "./server.js";

/**
 * The jar's three handlers, out here rather than in server.ts.
 *
 * server.ts is already 2,400 lines and wires the machine inline; a fifth
 * game inline would put it past 2,600. Nothing about this game needs a
 * table, a room or an adapter, so nothing about it needs to be in there.
 */

export type TipsSocket = Socket<ClientToServer, ServerToClient, DefaultEventsMap, SocketIdentity>;

export interface TipsDeps {
  store: Store;
  /**
   * Pushes a balance to every socket signed in as this account.
   *
   * The second argument is the balance already known from `applyJar`'s own
   * return, for a caller that has one — it saves the extra `store.get` that
   * `tellChips` would otherwise do to find out what it already knows. Tapping
   * is the one screen in the building meant to be pressed over and over, so
   * that round trip is not free to repeat on every accepted tap.
   */
  tellChips: (userId: string, knownChips?: number) => Promise<void>;
}

/**
 * `JarRecord` (packages/economy) and `Jar` (games/tips) are declared apart on
 * purpose — no package under packages/ may depend on a game — but nothing
 * stops the two drifting field by field once they exist. apps/server is the
 * only place both types are visible, so this is where the two are held to
 * agreeing with each other: `asJar` proves `JarRecord` is assignable to
 * `Jar`, `asRecord` proves the reverse, and both are genuinely called on real
 * jars below (at `tips:open`/`tips:tap`/`tips:buy` and the `applyJar` sites)
 * rather than sitting unused. Between the pair, a *required* field added to
 * either type alone fails the build here instead of surfacing later as a jar
 * read back with a field silently missing. An *optional* field added to
 * either side is caught by neither direction — it stays assignable both ways
 * and would slip through silently.
 */
function asJar(record: JarRecord): Jar {
  return record;
}

function asRecord(jar: Jar): JarRecord {
  return jar;
}

/** Every tap and buy read this jar's numbers off the same clock. */
function view(jar: Jar, now: number): JarView {
  const level = levelAt(jar, numbersFor(jar.bought), now);
  return viewOf(jar, now, level);
}

/**
 * `level` is a parameter rather than something computed inside, so the
 * caller — which has already worked it out via `levelAt` for whatever jar it
 * is showing — hands over a single answer instead of two computations that
 * could disagree.
 *
 * Module-private: every caller is inside this file, and a function used
 * nowhere else has no business on the module's public surface.
 */
function viewOf(jar: Jar, now: number, level: number): JarView {
  const numbers = numbersFor(jar.bought);
  return {
    level,
    at: now,
    brim: numbers.brim,
    trickle: numbers.trickle,
    scoop: numbers.scoop,
    favours: jar.favours,
    bought: jar.bought,
    chipsTonight: jar.paidThisNight,
    nightEndsAt: jar.nightStartedAt + NIGHT_MS,
    token: jar.token,
  };
}

const mint = () => randomUUID();

/**
 * The buy path's own lost-swap wording.
 *
 * `REFUSALS.stale` (games/tips) is written for the tap path — the common
 * case there is exactly a lost race — and it says so with the word "tap".
 * The buy handler loses the same kind of race at its own `applyJar` swap, so
 * it needs its own noun rather than borrowing that literal; spelling it out
 * once here keeps the two from drifting apart the way a copy-pasted string
 * would.
 */
const LOST_BUY_SWAP = "That buy was out of step. Try again.";

/**
 * `store.jar()` returning null means the signed-in identity does not resolve
 * to any account — a different failure from a malformed payload, which is
 * what `tapSchema`/`buySchema` already refuse in their own words just above.
 * Reusing "that is not a tap/buy" here would describe the wrong problem.
 */
const NO_SUCH_ACCOUNT = "That account doesn't exist.";

/**
 * Mints this jar's first real token if it has never been touched.
 *
 * A blank token is the zero jar's marker. `levelAt` and `nightStartedAt` are
 * set to `now` on the swap rather than left at the epoch the zero jar carries
 * them at — a `levelAt` of 0 would make `levelAt()` compute a full jar
 * instantly and hand every new account free chips no rule grants.
 */
async function ensureToken(
  store: Store,
  userId: string,
  held: { jar: JarRecord; chips: number },
  now: number,
): Promise<{ jar: JarRecord; chips: number }> {
  if (held.jar.token !== "") {
    return held;
  }
  const swapped = await store.applyJar(
    userId,
    "",
    { ...emptyJarRecord(), token: mint(), levelAt: now, nightStartedAt: now },
    0,
  );
  return { jar: swapped.jar, chips: swapped.chips };
}

export function wireTips(socket: TipsSocket, deps: TipsDeps): void {
  const { store, tellChips } = deps;

  /*
   * A failure answers with an empty jar, the same thing a guest or a refused
   * payload is shown: nothing to tap until the next open, and no promise the
   * store did not make.
   */
  const failedJar = () => {
    const now = Date.now();
    return view(emptyJar(now, ""), now);
  };

  socket.on("tips:open", (_payload, ack) => {
    acking("tips:open", ack, failedJar, async (ack) => {
      const now = Date.now();
      const userId = socket.data.identity?.userId ?? null;
      const held = userId === null ? null : await store.jar(userId);
      if (userId === null || held === null) {
        ack(view(emptyJar(now, ""), now));
        return;
      }
      const current = await ensureToken(store, userId, held, now);
      ack(view(asJar(current.jar), now));
    });
  });

  const failedTap = (): TapResult => ({ ok: false, error: SOMETHING_WENT_WRONG, jar: failedJar() });

  socket.on("tips:tap", (payload, ack) => {
    acking("tips:tap", ack, failedTap, async (ack) => {
      // There is no account to credit otherwise, so this is checked before
      // anything else touches the store.
      const userId = socket.data.identity?.userId ?? null;
      if (userId === null) {
        const now = Date.now();
        ack({ ok: false, error: "Sign in to tap the jar.", jar: view(emptyJar(now, ""), now) });
        return;
      }
      const parsed = tapSchema.safeParse(payload);
      if (!parsed.success) {
        const now = Date.now();
        ack({ ok: false, error: "That is not a tap.", jar: view(emptyJar(now, ""), now) });
        return;
      }
      const held = await store.jar(userId);
      if (held === null) {
        const now = Date.now();
        ack({ ok: false, error: NO_SUCH_ACCOUNT, jar: view(emptyJar(now, ""), now) });
        return;
      }
      const now = Date.now();
      const current = await ensureToken(store, userId, held, now);
      const outcome = tap(asJar(current.jar), now, parsed.data.token, mint);
      const swapped = await store.applyJar(
        userId,
        current.jar.token,
        asRecord(outcome.jar),
        outcome.ok ? outcome.paid : 0,
      );
      if (!swapped.ok) {
        // Another tap landed between the read above and this swap. Paying
        // here would be a second payout from a jar that has already moved,
        // so this resyncs the client with the token that actually won rather
        // than retrying.
        ack({
          ok: false,
          error: REFUSALS.stale,
          jar: view(asJar(swapped.jar), now),
        });
        return;
      }
      const jar = asJar(swapped.jar);
      if (outcome.ok && outcome.paid > 0) {
        // swapped.chips is the balance applyJar already returned — reading
        // it back from the store here would be a second round trip for a
        // number this handler is already holding.
        await tellChips(userId, swapped.chips);
        // No `shared` bump: games/wins/chipsWon are about playing against
        // other people, and counting time at the jar would inflate every
        // profile in the building for a game nobody else was in.
        await store.bumpStats(userId, {
          game: TIPS.id,
          add: { taps: 1, chipsTipped: outcome.paid },
          max: { bestNight: jar.paidThisNight },
        });
      }
      const result: TapResult = outcome.ok
        ? { ok: true, paid: outcome.paid, balance: swapped.chips, jar: view(jar, now) }
        : { ok: false, error: outcome.error, jar: view(jar, now) };
      ack(result);
    });
  });

  socket.on("tips:buy", (payload, ack) => {
    acking("tips:buy", ack, failedTap, async (ack) => {
      const userId = socket.data.identity?.userId ?? null;
      if (userId === null) {
        const now = Date.now();
        ack({ ok: false, error: "Sign in to tap the jar.", jar: view(emptyJar(now, ""), now) });
        return;
      }
      const parsed = buySchema.safeParse(payload);
      if (!parsed.success) {
        const now = Date.now();
        ack({ ok: false, error: "That is not a buy.", jar: view(emptyJar(now, ""), now) });
        return;
      }
      const held = await store.jar(userId);
      if (held === null) {
        const now = Date.now();
        ack({ ok: false, error: NO_SUCH_ACCOUNT, jar: view(emptyJar(now, ""), now) });
        return;
      }
      const now = Date.now();
      const current = await ensureToken(store, userId, held, now);
      const outcome = buy(asJar(current.jar), now, parsed.data.token, parsed.data.upgrade, mint);
      // A buy never moves chips either way, so the delta is always zero —
      // unlike a tap, there is nothing here for `tellChips` or stats to hear
      // about.
      const swapped = await store.applyJar(userId, current.jar.token, asRecord(outcome.jar), 0);
      if (!swapped.ok) {
        ack({
          ok: false,
          error: LOST_BUY_SWAP,
          jar: view(asJar(swapped.jar), now),
        });
        return;
      }
      const jar = asJar(swapped.jar);
      const result: TapResult = outcome.ok
        ? { ok: true, paid: outcome.paid, balance: swapped.chips, jar: view(jar, now) }
        : { ok: false, error: outcome.error, jar: view(jar, now) };
      ack(result);
    });
  });
}
