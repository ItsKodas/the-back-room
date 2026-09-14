import { LEADER_SORTS } from "@backroom/economy";
import type { LeaderSort, Store } from "@backroom/economy";
import type { Express, Request } from "express";

/**
 * Who is ahead.
 *
 * This is the one route in the building that publishes balances, which is the
 * exact opposite of the rule `PublicPlayer` exists to keep. The exception is
 * deliberate and written down in the design doc; what keeps it narrow is here:
 * it is behind a sign-in, it hands back the board's columns and nothing else,
 * and how many rows it gives out is not the caller's decision.
 */

/** How many rows a board carries. Not a query parameter: see above. */
export const BOARD_LIMIT = 100;

/**
 * How often one account may ask.
 *
 * Two permanent pollers hit this route, not one: the board page and the
 * front door's "Who's ahead" card each poll every ten seconds, six a minute,
 * and either can be open in any number of tabs at once. An ordinary handful
 * of tabs — four or five, some on the room and some on the board — already
 * asks 24-30 times a minute before anybody presses a sort header, and every
 * press adds an immediate ask on top of that tab's own poll. Budgeted for
 * ten such pollers (60/min) plus headroom for sort presses, not for one.
 */
const BOARD_TRIES = 90;
const BOARD_WINDOW_MS = 60_000;

export interface LeaderboardRoutes {
  store: Store;
  /** The signed-in player, or null. */
  whoIs: (request: Request) => Promise<{ id: string } | null>;
  /** True while this account is inside its allowance of requests. */
  withinBudget: (id: string, max: number, windowMs: number) => boolean;
}

/**
 * The column asked for, or chips.
 *
 * A bad one falls back rather than failing: this is a query parameter on a
 * page somebody linked to, not a command, and a link that has gone stale
 * should show a board rather than an error.
 */
export function readSort(raw: unknown): LeaderSort {
  const wanted = String(raw ?? "");
  return (LEADER_SORTS as readonly string[]).includes(wanted) ? (wanted as LeaderSort) : "chips";
}

export function mountLeaderboard(
  app: Express,
  { store, whoIs, withinBudget }: LeaderboardRoutes,
): void {
  app.get("/api/leaderboard", (request, response) => {
    void (async () => {
      const who = await whoIs(request);
      if (who === null) {
        response.status(401).json({ error: "Sign in first." });
        return;
      }
      if (!withinBudget(`board:${who.id}`, BOARD_TRIES, BOARD_WINDOW_MS)) {
        response.status(429).json({ error: "Slow down." });
        return;
      }
      const sort = readSort(request.query["sort"]);
      const board = await store.leaderboard({ sort, limit: BOARD_LIMIT, you: who.id });
      response.json({ sort, ...board });
    })();
  });
}
