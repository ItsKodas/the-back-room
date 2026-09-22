import type { Kind } from "@backroom/game-roulette";
import { pays, SPOTS } from "@backroom/game-roulette";
import { useSheetDismiss } from "../table/useSheetDismiss.js";

export const PAYS_SHEET_ID = "rl-pays";

/** What each kind of bet is called on a sheet, in the order a cloth teaches them. */
const ORDER: ReadonlyArray<{ kind: Kind; name: string; note: string }> = [
  { kind: "straight", name: "Straight up", note: "One number" },
  { kind: "split", name: "Split", note: "Two, on the line between" },
  { kind: "street", name: "Street", note: "A row of three" },
  { kind: "corner", name: "Corner", note: "Four, where they meet" },
  { kind: "trio", name: "Trio", note: "The zero and two beside it" },
  { kind: "basket", name: "Basket", note: "The zero and the first three" },
  { kind: "six", name: "Six line", note: "Two rows" },
  { kind: "column", name: "Column", note: "Twelve, down the cloth" },
  { kind: "dozen", name: "Dozen", note: "Twelve, across it" },
  { kind: "even", name: "Even money", note: "Red, black, odd, even, halves" },
];

/**
 * What every bet on the cloth pays.
 *
 * Every figure comes from `pays()` in the rules rather than from a list here.
 * A sheet that can disagree with the payouts is worse than no sheet — the
 * cloth learned this once already, when `dressOf` went on testing for "2 to 1"
 * after the cloth had started saying "2:1" and quietly styled nothing.
 */
export function HowItPays({
  open,
  onClose,
  lit,
}: {
  open: boolean;
  onClose: () => void;
  /** The kind of bet currently aimed at, whose row lights. */
  lit: Kind | null;
}) {
  /*
   * It calls itself a dialog, so it has to behave like one: Escape shuts it and
   * focus goes back to the ? key. Shared with table talk rather than written
   * again here — the two stand on the same rectangle, and the one that shut
   * differently would be the one a player stopped trusting.
   */
  const panel = useSheetDismiss({ open, onClose, id: PAYS_SHEET_ID });

  if (!open) {
    return null;
  }
  return (
    <div
      className="rl__pays housing"
      id={PAYS_SHEET_ID}
      role="dialog"
      aria-label="What it pays"
      ref={panel}
      tabIndex={-1}
    >
      <div className="housing__head">
        <span className="label">What it pays</span>
        <button
          type="button"
          className="key key--icon"
          aria-label="Close what it pays"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <ul className="rl__pays-list housing__body table-scroll">
        {ORDER.map(({ kind, name, note }) => {
          const one = [...SPOTS.values()].find((spot) => spot.kind === kind);
          if (one === undefined) {
            return null;
          }
          return (
            <li key={kind} className={`rl__pays-row${lit === kind ? " rl__pays-row--lit" : ""}`}>
              <span className="rl__pays-name">{name}</span>
              <span className="rl__pays-note">{note}</span>
              <span className="rl__pays-odds">{`${pays(one)} to 1`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
