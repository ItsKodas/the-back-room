import type { TableView } from "@backroom/game-uno";
import { unoAdapter } from "@backroom/game-uno";

/** A seeded source, so a fixture deals the same hands every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A real table, dealt by the real game, seen from "me".
 *
 * Built rather than written out by hand, so a fixture can never describe a
 * felt the game could not produce.
 */
export async function dealt(rules: Record<string, unknown> = {}, seed = 3) {
  const adapter = unoAdapter({ rng: seeded(seed) });
  const table = adapter.create("ABCDE", { forFun: true, uno: rules }) as unknown as import("@backroom/game-uno").Table;
  table.join("me", "Me", null);
  table.join("them", "Them", null);
  table.setReady("me", true, Date.now());
  table.setReady("them", true, Date.now());
  table.askForGame(Date.now());
  await adapter.payOut?.(table, {
    take: async () => true,
    give: async () => undefined,
    record: async () => undefined,
    finished: async () => undefined,
  });
  return { table, view: (seat: string | null = "me"): TableView => table.view(seat) };
}
