import { useEffect, useState } from "react";

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
  | { kind: "ios" }
  | { kind: "manual" };

/** Chrome's install event. Not in the DOM typings because it is not a standard. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
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
 * The install offer, as it stands.
 *
 * Chrome's event is caught and held rather than left to show its own bar, so
 * the offer lives on our button — somewhere a player will find it again — and
 * not in a banner that shows once and is dismissed on the way to a table.
 *
 * Installing from this tab does not make this tab the app, so `appinstalled`
 * changes nothing here: the tab stays a browser tab and keeps its button. Only
 * a page that opened as the app hides it.
 */
export function useInstall(): InstallOffer {
  const [held, setHeld] = useState<InstallPromptEvent | null>(null);
  const [standalone] = useState(() => isStandalone());

  useEffect(() => {
    const offered = (event: Event) => {
      event.preventDefault();
      setHeld(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", offered);
    return () => window.removeEventListener("beforeinstallprompt", offered);
  }, []);

  if (standalone) {
    return { kind: "installed" };
  }
  if (held !== null) {
    return {
      kind: "prompt",
      install: () => {
        void held.prompt();
        // A prompt is good for one use, whichever way it was answered.
        void held.userChoice.then(() => setHeld(null));
      },
    };
  }
  if (isIos(window.navigator.userAgent, window.navigator.maxTouchPoints)) {
    return { kind: "ios" };
  }
  return { kind: "manual" };
}
