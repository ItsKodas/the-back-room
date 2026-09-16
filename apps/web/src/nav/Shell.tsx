import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "./Navbar.js";
import { NavProvider, useNavSettings } from "./NavContext.js";

/**
 * The building around every page: the bar, and the room under it.
 *
 * A layout route, so walking between pages swaps what is under the bar and
 * never the bar itself. When each page drew its own, every link threw the bar
 * away and built another — the balance blinked out while the new one asked
 * who you were, and the sound and install controls lost whatever they were
 * in the middle of.
 */
export function Shell() {
  return (
    <NavProvider>
      <div className="shell">
        <Bar />
        <Outlet />
      </div>
    </NavProvider>
  );
}

function Bar() {
  const account = useAccount();
  const { refresh } = account;
  const { room, ...bar } = useNavSettings();

  useLayoutEffect(() => {
    if (room === undefined) {
      return;
    }
    document.documentElement.dataset["game"] = room;
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, [room]);

  /*
   * Asked again on the way into another part of the building, as it was when
   * every page asked for itself — a balance can move somewhere no socket told
   * this window about. Not on every address change: a table rewriting its own
   * code into the address is not somewhere new, and a stale answer landing
   * mid-hand would roll the balance back under a stake.
   */
  const section = useLocation().pathname.split("/")[1] ?? "";
  const seen = useRef(section);
  useEffect(() => {
    if (seen.current === section) {
      return;
    }
    seen.current = section;
    refresh();
  }, [section, refresh]);

  return (
    <div className="shell__bar">
      <Navbar {...bar} account={account} />
    </div>
  );
}
