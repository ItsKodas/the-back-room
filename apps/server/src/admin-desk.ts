import { BANKS } from "@backroom/economy";
import type { AdminLogEntry, AdminTarget, Store } from "@backroom/economy";
import { adminChipsSchema, adminResetSchema } from "@backroom/shared/schemas";
import type { Express, Request, RequestHandler } from "express";
import express from "express";

/**
 * The admin desk: players, their chips, and the record of what was done.
 *
 * Every route here is behind the allowlist that mints codes, because giving
 * chips is the same power as minting them — chips nobody won. That is also
 * why every one of them writes to the log before it answers.
 */

/**
 * The routes that take a list of ids.
 *
 * The building parses JSON at eight kilobytes and five hundred ids is about
 * thirteen, so these carry their own parser and the small one steps aside for
 * them, the way it already does for an emote upload.
 */
export const ADMIN_BULK_PATHS: readonly string[] = ["/api/admin/chips", "/api/admin/reset"];
const bulkJson = express.json({ limit: "64kb" });

const PAGE = 50;

export interface SeatedTable {
  seats: ReadonlyArray<{ userId: string | null; isBot: boolean }>;
}

/**
 * How many live tables have somebody a reset would touch sitting at them.
 *
 * Seated rather than connected: a player who dropped mid-hand still has
 * chips on that felt, and nothing can give those back yet. Until tables can
 * be voided, a reset that would land under a live hand is refused.
 */
export function tablesHolding(tables: Iterable<SeatedTable>, target: AdminTarget): number {
  const wanted = "all" in target ? null : new Set(target.ids);
  let count = 0;
  for (const table of tables) {
    const held = table.seats.some(
      (seat) => !seat.isBot && seat.userId !== null && (wanted === null || wanted.has(seat.userId)),
    );
    if (held) {
      count += 1;
    }
  }
  return count;
}

export interface AdminDeskRoutes {
  store: Store;
  requireAdmin: RequestHandler;
  whoIs: (request: Request) => Promise<{ id: string; name: string } | null>;
  /** Pushes fresh balances to whoever this reached and is connected. */
  tellChipsTo: (target: AdminTarget) => Promise<void>;
  /** The live tables, read at the moment a reset is asked for. */
  tables: () => Iterable<SeatedTable>;
  /** Drops an emote from whatever the server remembers of it. */
  forgetEmote: (id: string) => void;
}

function logTarget(target: AdminTarget): "all" | string[] {
  return "all" in target ? "all" : [...new Set(target.ids)];
}

export function mountAdminDesk(app: Express, deps: AdminDeskRoutes): void {
  const { store, requireAdmin, whoIs, tellChipsTo, tables, forgetEmote } = deps;

  async function log(request: Request, entry: Omit<AdminLogEntry, "id" | "at" | "by" | "byName">) {
    const who = await whoIs(request);
    await store.logAdmin({ ...entry, by: who?.id ?? "unknown", byName: who?.name ?? "unknown" });
  }

  app.get("/api/admin/users", requireAdmin, (request, response) => {
    void (async () => {
      const offset = Math.max(0, Math.floor(Number(request.query["offset"] ?? 0)) || 0);
      const query = String(request.query["q"] ?? "").slice(0, 32);
      response.json(await store.listUsers({ query, offset, limit: PAGE }));
    })();
  });

  app.post("/api/admin/chips", requireAdmin, bulkJson, (request, response) => {
    void (async () => {
      const parsed = adminChipsSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "That is not something the desk can do." });
        return;
      }
      const { op, amount, target, note } = parsed.data;
      const result = await store.adjustBalances({ target, op, amount });
      await log(request, {
        kind: op,
        // What moved, not what was asked: taking 5,000 from somebody holding
        // 1,200 took 1,200, and the record should say so.
        amount: op === "set" ? amount : Math.abs(result.moved),
        affected: result.affected,
        target: logTarget(target),
        parts: null,
        subject: null,
        note: (note ?? "").trim(),
      });
      await tellChipsTo(target);
      response.json(result);
    })();
  });

  app.post("/api/admin/reset", requireAdmin, bulkJson, (request, response) => {
    void (async () => {
      const parsed = adminResetSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "That is not something the desk can do." });
        return;
      }
      const { target, parts, emptyBanks, note } = parsed.data;
      const held = tablesHolding(tables(), target);
      if (held > 0) {
        response.status(409).json({
          error: held === 1 ? "A table still has them seated." : `${held} tables still have them seated.`,
          seatedAt: held,
        });
        return;
      }
      const result = await store.resetUsers({ target, parts });
      await log(request, {
        kind: "reset",
        amount: 0,
        affected: result.affected,
        target: logTarget(target),
        parts: [...parts],
        subject: null,
        note: (note ?? "").trim(),
      });
      let emptied: number | undefined;
      if (emptyBanks === true) {
        emptied = 0;
        for (const bank of BANKS) {
          emptied += await store.bankEmpty(bank);
        }
        await log(request, {
          kind: "empty-banks",
          amount: emptied,
          affected: 0,
          target: "all",
          parts: null,
          subject: null,
          note: (note ?? "").trim(),
        });
      }
      await tellChipsTo(target);
      response.json(emptied === undefined ? result : { ...result, emptied });
    })();
  });

  app.get("/api/admin/log", requireAdmin, (request, response) => {
    void (async () => {
      const raw = Number(request.query["before"]);
      const before = Number.isFinite(raw) && raw > 0 ? raw : null;
      response.json({ entries: await store.adminLog({ limit: PAGE, before }) });
    })();
  });

  /**
   * Deletes an emote for good.
   *
   * A pool still holding it keeps its chips — those live on the taunt, not on
   * the emote — and its replay shows the name with nothing behind it.
   */
  app.post("/api/admin/emotes/:id/delete", requireAdmin, (request, response) => {
    void (async () => {
      const id = String(request.params["id"] ?? "");
      const emote = (await store.listEmotes(true)).find((one) => one.id === id);
      if (emote === undefined || !(await store.deleteEmote(id))) {
        response.status(404).json({ error: "No such emote." });
        return;
      }
      forgetEmote(id);
      await log(request, {
        kind: "delete-emote",
        amount: 0,
        affected: 0,
        target: "all",
        parts: null,
        subject: emote.name,
        note: "",
      });
      response.json({ ok: true });
    })();
  });
}
