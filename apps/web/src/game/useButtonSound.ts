import { useEffect } from "react";
import { play, unlock } from "./audio.js";

/**
 * A press, wherever it happens.
 *
 * One listener on the document rather than a handler on every button. There
 * are dozens of buttons across the building and there will be more, and a
 * sound that has to be remembered on each one is a sound that is missing from
 * half of them within a month.
 *
 * On the way down, not the way up. A click sound that waits for pointerup
 * arrives after the finger has already lifted, which reads as lag on the
 * button rather than as the button.
 */

/** What counts as a press: real buttons, radio-styled buttons, and link-buttons. */
const PRESSABLE = 'button, [role="radio"], a.slab, a.key, a.quiet';

export function useButtonSound(): void {
  useEffect(() => {
    const pressed = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const control = target.closest(PRESSABLE);
      if (control === null) {
        return;
      }
      // A control nobody can press should not sound like one they can.
      if (control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true") {
        return;
      }
      /*
       * Controls with a sound of their own say so. A chip already lands with a
       * clatter when it is pushed onto the felt, and a click underneath that
       * is not two sounds — it is one muddied one.
       */
      if (control.closest("[data-quiet]") !== null) {
        return;
      }
      // The first press of the session is also what buys us an audio context,
      // so this has to come before the sound rather than instead of it.
      unlock();
      play("tap");
    };

    document.addEventListener("pointerdown", pressed);
    return () => document.removeEventListener("pointerdown", pressed);
  }, []);
}
