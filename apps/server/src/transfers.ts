import type { Store } from "@backroom/economy";
import { DAILY_SEND_CAP, SEND_REFUSALS, SEND_WINDOW_MS, leftToSend } from "@backroom/economy";
import type { Express, Request, RequestHandler } from "express";
import { bestEffort, handle } from "./handle.js";

/**
 * Paying another player.
 *
 * The first thing in this building that moves chips with no game played, so
 * two things are true of every route below. It conserves — a debit and a
 * credit of one number, decided by the store rather than by anything here —
 * and it is written down, because "where did these chips come from" is a
 * question this economy has always been able to answer and a transfer must not
 * be the gap in it.
 */

/**
 * The least somebody must type before the room will look anybody up.
 *
 * Searching by name is the one route here that answers questions about people
 * who are not asking, so it declines to answer the broadest ones. A single
 * letter is not a search for somebody, it is a page of the directory.
 */
export const MIN_SEARCH = 2;

/** The most matches one search hands back. */
export const SEARCH_LIMIT = 8;

/** How many transfers a profile page shows. */
const LEDGER_LIMIT = 25;

export interface TransferRoutes {
  store: Store;
  /** The signed-in player, or null. */
  whoIs: (request: Request) => Promise<{ id: string; name: string } | null>;
  /**
   * Pushes a balance to whoever is signed in as that account.
   *
   * Passed in because the recipient is very often looking at the site when
   * they are paid, and a balance that only catches up on a page load is a
   * balance nobody trusts — the same reason a stake or a payout is pushed.
   */
  tellChips: (userId: string) => Promise<void>;
  /** True while this account is inside its allowance of requests. */
  withinBudget: (id: string, max: number, windowMs: number) => boolean;
}

/** How often one account may search, and send. */
const SEARCH_TRIES = 30;
const SEARCH_WINDOW_MS = 60_000;
const SEND_TRIES = 10;
const SEND_TRIES_WINDOW_MS = 60_000;

export function mountTransfers(
  app: Express,
  { store, whoIs, tellChips, withinBudget }: TransferRoutes,
): void {
  /** Everything below is for a signed-in player about their own account. */
  const signedIn = (
    run: (
      who: { id: string; name: string },
      request: Request,
      response: Parameters<RequestHandler>[1],
    ) => Promise<void>,
  ): RequestHandler => {
    return handle(async (request, response) => {
      const who = await whoIs(request);
      if (who === null) {
        response.status(401).json({ error: "Sign in first." });
        return;
      }
      await run(who, request, response);
    });
  };

  /**
   * Who somebody might mean.
   *
   * Names are Discord display names and two players can share one, so this
   * cannot be the whole of picking a recipient — it narrows a name down to a
   * handful of people, and the id one of them carries is what actually gets
   * paid. A match says who somebody is and nothing about what they hold.
   */
  app.get(
    "/api/players",
    signedIn(async (who, request, response) => {
      if (!withinBudget(`search:${who.id}`, SEARCH_TRIES, SEARCH_WINDOW_MS)) {
        response.status(429).json({ error: "Slow down." });
        return;
      }
      const query = String(request.query["q"] ?? "").trim();
      if (query.length < MIN_SEARCH) {
        response.json({ players: [] });
        return;
      }
      const found = await store.findPlayers(query, SEARCH_LIMIT + 1);
      response.json({
        // Yourself filtered out here rather than in the store, which has no
        // opinion about who is asking.
        players: found.filter((player) => player.id !== who.id).slice(0, SEARCH_LIMIT),
      });
    }),
  );

  /** This account's own ledger, and what is left of today's allowance. */
  app.get(
    "/api/transfers",
    signedIn(async (who, _request, response) => {
      const sent = await store.sentSince(who.id, Date.now() - SEND_WINDOW_MS);
      response.json({
        transfers: await store.transfers(who.id, LEDGER_LIMIT),
        leftToday: leftToSend(sent),
        cap: DAILY_SEND_CAP,
      });
    }),
  );

  /**
   * Paying somebody.
   *
   * The amount and the recipient are all this takes. What the sender holds and
   * what they have already sent today are read by the store, so a client
   * cannot offer its own answer to either — the same reason the cost of a
   * taunt is read off the emote rather than out of the payload.
   */
  app.post(
    "/api/send",
    signedIn(async (who, request, response) => {
      if (!withinBudget(`send:${who.id}`, SEND_TRIES, SEND_TRIES_WINDOW_MS)) {
        response.status(429).json({ ok: false, error: "Slow down." });
        return;
      }
      const body = (request.body ?? {}) as { toId?: unknown; amount?: unknown };
      const toId = typeof body.toId === "string" ? body.toId : "";
      const amount = typeof body.amount === "number" ? body.amount : Number.NaN;
      if (toId.length === 0) {
        response.status(400).json({ ok: false, error: SEND_REFUSALS["no-recipient"] });
        return;
      }

      const result = await store.send(who.id, toId, amount);
      if (!result.ok) {
        response
          .status(400)
          .json({ ok: false, error: SEND_REFUSALS[result.reason], leftToday: result.leftToday });
        return;
      }

      /*
       * Both ends told, not just the one that asked. The sender gets their
       * balance in the reply; the recipient is very often looking at the site
       * and should see it arrive rather than find it later.
       *
       * But only as well as it can be done. The chips have moved by now, and
       * a 500 here would read as "not sent" to somebody about to send again.
       */
      await bestEffort("telling both ends of a transfer", tellChips(who.id), tellChips(result.to.id));
      response.json({
        ok: true,
        balance: result.balance,
        amount: result.amount,
        leftToday: result.leftToday,
        to: result.to,
      });
    }),
  );
}
