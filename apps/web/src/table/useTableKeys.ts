import type { RefObject } from "react";
import { useEffect } from "react";

export interface TableKeys {
  /** Which key presses which button, by the name the button declares. */
  shortcuts: Readonly<Record<string, string>>;
  /** What a pointer going down inside hands its keys to the table. Omit where the table has no such piece. */
  holds?: string;
}

/**
 * Space for the lit slab; whatever else `keys.shortcuts` maps.
 *
 * Presses the button on screen rather than calling what it calls, so a key can
 * never do what the button would refuse: a disabled or busy button is a key
 * that does nothing. Bound once; the buttons are looked up through the table's
 * ref at the moment the key goes down, so nothing here goes stale.
 */
export function useTableKeys(root: RefObject<HTMLElement | null>, keys: TableKeys): void {
  useEffect(() => {
    /*
     * The piece a pointer last went down on. Remembered here rather than asked
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
      const name = keys.shortcuts[event.key.toLowerCase()];
      if (name === undefined) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Typing is typing, and a sheet has keys of its own.
      if ((target?.closest("input, textarea, select, [contenteditable], [role='dialog']") ?? null) !== null) {
        return;
      }
      if (name === "Space" && target !== null) {
        const held = keys.holds === undefined ? null : target.closest(keys.holds);
        /*
         * A piece somebody clicked hands Space to the table: stack chips, press
         * Space, is the rhythm of a bet. A piece reached by keyboard keeps its
         * own Space, since that is how a keyboard presses it at all, and any
         * other focused button or link presses itself.
         */
        if (held !== null ? held !== clicked : target.closest("a, button") !== null) {
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
        keys.holds === undefined || !(event.target instanceof Element)
          ? null
          : event.target.closest(keys.holds);
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
  }, [root, keys.shortcuts, keys.holds]);
}
