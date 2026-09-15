import { useEffect, useState } from "react";

/** What this browser can do about putting the room on a home screen. */
export type InstallOffer = { kind: "prompt"; install: () => void } | { kind: "ios" } | { kind: "none" };

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
 */
export function useInstall(): InstallOffer {
  const [held, setHeld] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const offered = (event: Event) => {
      event.preventDefault();
      setHeld(event as InstallPromptEvent);
    };
    const done = () => {
      setInstalled(true);
      setHeld(null);
    };
    window.addEventListener("beforeinstallprompt", offered);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", offered);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed) {
    return { kind: "none" };
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
  return { kind: "none" };
}
