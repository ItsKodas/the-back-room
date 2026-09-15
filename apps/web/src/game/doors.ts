import type { MouseEvent } from "react";
import { play, unlock } from "./audio.js";

/**
 * The sound of walking through a door: into a game from the room, or back out.
 *
 * On click rather than on pointerdown, unlike every other press. A card on the
 * room is something a thumb lands on while scrolling past it, and a door that
 * sounds when nobody went through it is a lie; a click only fires once the
 * press has turned out to be a press.
 *
 * Only for a click that navigates this page. A modified click opens a new tab
 * and this page goes nowhere, so nothing opened or shut here.
 */
export function throughTheDoor(event: MouseEvent, cue: "open" | "close"): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  // The room's cards are not buttons, so this may be the first press of the
  // session and the one that has to buy the audio context.
  unlock();
  play(cue);
}
