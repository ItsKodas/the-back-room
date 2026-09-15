import { useState, useSyncExternalStore } from "react";

/**
 * What this page can do about putting the room on a home screen.
 *
 * `installed` is the one state with nothing to offer: the page is already the
 * app. Every browser tab gets an offer of some kind, because a button that only
 * appears on the browsers that fire an install event is missing on most of
 * them.
 */
export type InstallOffer =
  | { kind: "installed" }
  | { kind: "prompt"; install: () => void }
  | { kind: "ios"; chrome: boolean }
  | { kind: "manual" };

/** Chrome's install event. Not in the DOM typings because it is not a standard. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * The browser's prompt, held for the page rather than by any one bar.
 *
 * A browser sends it once per page load, whenever it decides the page can be
 * installed — which can be before a bar has mounted to catch it. And every page
 * draws its own bar, so a prompt kept inside one was thrown away the first time
 * somebody walked from the front door to a table, after which the press could
 * only explain instead of install. Caught here, as this module loads, it
 * survives both.
 */
let held: InstallPromptEvent | null = null;
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of watchers) {
    watcher();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Held back, so the browser's own mini-infobar does not show on its own.
    event.preventDefault();
    held = event as InstallPromptEvent;
    announce();
  });
}

function watch(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

function currentPrompt(): InstallPromptEvent | null {
  return held;
}

/** Whether this page is already running as the installed app. */
export function isStandalone(win: Window = window): boolean {
  return (
    win.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (win.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Whether this is an iPhone or iPad.
 *
 * An iPad has said it is a Mac since iPadOS 13, so the user agent alone cannot
 * tell. A Mac has no touch screen, and that is the difference.
 */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * Whether an iOS browser is Chrome.
 *
 * Every browser on iOS is Safari underneath, so none of them has a prompt to
 * give; what differs is where each keeps its Share button.
 */
export function isChromeOnIos(userAgent: string): boolean {
  return /CriOS/.test(userAgent);
}

/**
 * The install offer, as it stands.
 *
 * Installing from this tab does not make this tab the app, so the button stays
 * in a browser tab after an install. Only a page that opened as the app hides
 * it.
 */
export function useInstall(): InstallOffer {
  const prompt = useSyncExternalStore(watch, currentPrompt, () => null);
  const [standalone] = useState(() => isStandalone());

  if (standalone) {
    return { kind: "installed" };
  }
  if (prompt !== null) {
    return {
      kind: "prompt",
      install: () => {
        /*
         * Spent on the press rather than when it is answered. A browser answers
         * a prompt once and refuses the second call, so a quick second press —
         * on this bar or on the next page's — has to explain instead.
         */
        held = null;
        announce();
        void prompt.prompt();
      },
    };
  }
  const agent = window.navigator.userAgent;
  if (isIos(agent, window.navigator.maxTouchPoints)) {
    return { kind: "ios", chrome: isChromeOnIos(agent) };
  }
  return { kind: "manual" };
}
