import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Banks } from "./Banks.js";
import { Codes } from "./Codes.js";
import { Emotes } from "./Emotes.js";
import { Log } from "./Log.js";
import { Players } from "./Players.js";
import "./admin.css";

export { BANKS } from "./Banks.js";

export type TabId = "banks" | "players" | "codes" | "emotes" | "log";

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "banks", label: "Banks" },
  { id: "players", label: "Players" },
  { id: "codes", label: "Codes" },
  { id: "emotes", label: "Emotes" },
  { id: "log", label: "Log" },
];

const PANELS: Record<TabId, () => JSX.Element> = {
  banks: Banks,
  players: Players,
  codes: Codes,
  emotes: Emotes,
  log: Log,
};

/**
 * The admin desk.
 *
 * Reachable only by the Discord ids in the allowlist, and invisible to anyone
 * else — the server answers "not found" rather than "not allowed", so whether
 * this page exists is not something a visitor learns by asking.
 *
 * The tab lives in the URL so a reload stays where it was and one admin can
 * send another straight to the players.
 */
export function Admin() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = TABS.some((one) => one.id === asked) ? (asked as TabId) : "banks";

  useEffect(() => {
    void fetch("/api/admin/log", { credentials: "include" })
      .then((response) => setAllowed(response.ok))
      .catch(() => setAllowed(false));
  }, []);

  const Panel = PANELS[tab];

  return (
    <main className="room">
      {allowed === null ? null : allowed ? (
        <div className="desk">
          <div className="desk__tabs" role="tablist" aria-label="Admin desk">
            {TABS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                id={`desk-tab-${one.id}`}
                aria-selected={one.id === tab}
                aria-controls="desk-panel"
                className="desk__tab"
                onClick={() => setParams({ tab: one.id })}
              >
                {one.label}
              </button>
            ))}
          </div>
          <div
            className="desk__panel"
            role="tabpanel"
            id="desk-panel"
            aria-labelledby={`desk-tab-${tab}`}
            key={tab}
          >
            <Panel />
          </div>
        </div>
      ) : (
        <p className="not-found">No such page.</p>
      )}
    </main>
  );
}
