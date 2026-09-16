/**
 * Arrow/Home/End movement inside a single-select radiogroup, roving-tabindex
 * style: the group holds exactly one tab stop, and moving it also chooses
 * the option landed on — the behaviour a native `<input type=radio>` group
 * gives for free, which a row of ordinary buttons never did (that was one of
 * the tray's own four known defects: twelve separately tabbable controls
 * with no arrow-key semantics behind the `role="radiogroup"` they claimed).
 *
 * Pure so the index arithmetic can be tested without a DOM; the caller (see
 * Tray.tsx) supplies which element is `current` and moves focus itself.
 */
export function nextRadioIndex(key: string, current: number, count: number): number | null {
  if (count === 0) {
    return null;
  }
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowRight":
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    default:
      return null;
  }
}
