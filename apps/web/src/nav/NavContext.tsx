import type { ReactNode } from "react";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import type { NavTable } from "./Navbar.js";

/** What a page tells the bar about itself. Anything left out, the bar leaves out. */
export interface NavSettings {
  /** The game's name as it is written — markup, because Greed lights a letter. */
  game?: ReactNode;
  table?: NavTable;
  /** Whether the page's socket is up. Left out on pages with no socket at all. */
  connected?: boolean;
  /**
   * Which room you are standing in, and so the colour of the bar and of
   * everything around it. It goes on the document rather than on the page:
   * the background and the haze live outside any page, so a room that
   * repainted only its own subtree would be a coloured rectangle sitting in
   * the building's blue.
   */
  room?: string;
}

const Settings = createContext<NavSettings>({});
const SetSettings = createContext<((next: NavSettings) => void) | null>(null);

/**
 * Holds what the current page has said about the bar.
 *
 * The setter and the settings are separate contexts so that a page, which
 * only ever sets, is not re-rendered by its own update — otherwise every
 * render would set, and every set would render.
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<NavSettings>({});
  return (
    <SetSettings.Provider value={setSettings}>
      <Settings.Provider value={settings}>{children}</Settings.Provider>
    </SetSettings.Provider>
  );
}

export function useNavSettings(): NavSettings {
  return useContext(Settings);
}

/**
 * Dress the bar for this page.
 *
 * The bar itself belongs to the building and stays put between pages; a page
 * only says what should be on it. Layout effects, so the bar changes in the
 * same frame as the page does rather than one frame after it. Outside the
 * building's shell — a page rendered on its own in a test — this does nothing.
 */
export function useNav(settings: NavSettings): void {
  const set = useContext(SetSettings);
  // Every render rather than on a dependency list: a table's state is new each
  // time it changes, and with it whether leaving should ask first.
  useLayoutEffect(() => {
    set?.(settings);
  });
  // Unmount cleanups run before the next page's layout effects in the same
  // commit, so walking between two games never paints a bare bar between them.
  useLayoutEffect(() => () => set?.({}), [set]);
}
