import type { RefObject } from "react";
import { useTableKeys } from "../table/useTableKeys.js";

/** Which key presses which button, by the name the button declares in aria-keyshortcuts. */
const SHORTCUTS: Readonly<Record<string, string>> = { " ": "Space", s: "S", d: "D", p: "P" };

/**
 * Space for the lit slab; S, D and P for Stand, Double and Split.
 *
 * A chip somebody clicked hands Space to the table: stack chips, press Space,
 * is the rhythm of a bet. A chip reached by keyboard keeps its own Space,
 * since that is how a keyboard adds one at all.
 */
export function useBlackjackKeys(root: RefObject<HTMLElement | null>): void {
  useTableKeys(root, SHORTCUTS, { handsOverSpace: ".bj__chip" });
}
