import type { RefObject } from "react";
import { useEffect } from "react";

/**
 * Presses the button on screen rather than calling what it calls, so a key can
 * never do what the button would refuse: a disabled or busy button is a key
 * that does nothing. Bound once; the buttons are looked up through the table's
 * ref at the moment the key goes down, so nothing here goes stale.
 *
 * `shortcuts` maps a lowercased key to the name a button declares in its
 * aria-keyshortcuts. `handsOverSpace`, when given, is a selector for pieces
 * that hand Space to the table once clicked — Blackjack's chips, stacked with
 * Space pressed after, are the rhythm this exists for.
 */
export function useTableKeys(
  root: RefObject<HTMLElement | null>,
  shortcuts: Readonly<Record<string, string>>,
  options?: { readonly handsOverSpace?: string },
): void {
  const hands = options?.handsOverSpace;

  useEffect(() => {
    /*
     * The chip a pointer last went down on. Remembered here rather than asked
     * of the browser: Chrome reports a clicked button as :focus-visible the
     * moment any key goes down on it, which is exactly when this needs to know.
     * Focus arriving anywhere else, a Tab included, forgets it.
     */
    let clicked: Element | null = null;

    const onDown = (event: KeyboardEvent) => {
      // A modifier makes it somebody else's shortcut; a held key is one press.
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const name = shortcuts[event.key.toLowerCase()];
      if (name === undefined) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Typing is typing, and a sheet has keys of its own.
      if ((target?.closest("input, textarea, select, [contenteditable], [role='dialog']") ?? null) !== null) {
        return;
      }
      if (name === "Space" && target !== null && hands !== undefined) {
        const piece = target.closest(hands);
        /*
         * A chip somebody clicked hands Space to the table: stack chips, press
         * Space, is the rhythm of a bet. A chip reached by keyboard keeps its
         * own Space, since that is how a keyboard adds one at all, and any other
         * focused button or link presses itself.
         */
        if (piece !== null ? piece !== clicked : target.closest("a, button") !== null) {
          return;
        }
      }
      const button = root.current?.querySelector<HTMLButtonElement>(`button[aria-keyshortcuts="${name}"]`) ?? null;
      if (button === null || button.disabled || button.classList.contains("is-busy")) {
        return;
      }
      // Not the page scrolling, and not a focused chip adding itself on key-up.
      event.preventDefault();
      button.click();
    };
    const onPointer = (event: Event) => {
      clicked =
        hands === undefined || !(event.target instanceof Element) ? null : event.target.closest(hands);
    };
    const onFocus = (event: Event) => {
      if (event.target !== clicked) {
        clicked = null;
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("focusin", onFocus);
    };
  }, [root, shortcuts, hands]);
}
