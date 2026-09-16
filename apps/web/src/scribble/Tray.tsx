import type { Ink } from "@backroom/game-scribble";
import { INKS, SIZES } from "@backroom/game-scribble";
import type { KeyboardEvent } from "react";
import { nextRadioIndex } from "./radioNav.js";
import type { Tool } from "./useInk.js";

/* The napkin's own colour is the eraser, not an ink anybody chooses. */
export const TRAY_INKS: Ink[] = INKS.filter((ink) => ink !== "paper");

const NAMES: Record<Ink, string> = {
  black: "Black",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  brown: "Brown",
  white: "White",
  paper: "Paper",
};

/*
 * One name per `SIZES` entry, in that array's own (wire) order — see the
 * comment on `SIZES` itself for why the array isn't sorted by diameter.
 */
const SIZE_NAMES = ["Fine", "Medium", "Thick", "Hairline", "Bold"];

/*
 * Displayed smallest to largest regardless of where an index actually sits
 * in `SIZES`. Computed rather than written out by hand, so a size added
 * later only has to pick an index and a diameter — this reorders itself.
 */
const SIZE_ORDER = SIZES.map((_, index) => index).sort((a, b) => (SIZES[a] as number) - (SIZES[b] as number));

type ToolMode = Tool["mode"];

/*
 * The pencil, the eraser and the fill bucket are one choice, not a pen mode
 * plus two independent toggles: exactly one is ever in effect, so the group
 * is a radiogroup like the ink and the size beside it, not `aria-pressed`
 * buttons layered on top of whichever ink is picked.
 */
const TOOLS: ReadonlyArray<{ mode: ToolMode; label: string; icon: JSX.Element }> = [
  {
    mode: "pen",
    label: "Pencil",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    mode: "eraser",
    label: "Eraser",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 4l5 5-10 10H6l-3-3z" />
        <path d="M11 9l5 5" />
        <path d="M9 20h12" />
      </svg>
    ),
  },
  {
    mode: "fill",
    label: "Fill",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 13 11 6l7 7-7 7z" />
        <path d="M8 3l3 3" />
        <path d="M19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z" />
      </svg>
    ),
  },
];

/*
 * Roving tabindex for a `role="radiogroup"`: the arrow keys move the group's
 * one tab stop and pick the option they land on, same as a native radio
 * group. Reads the option elements straight off the DOM rather than keeping
 * a parallel list in React state — there is never more than one group's
 * worth of them, and this is the only place that needs the order.
 */
function onRadioKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const current = radios.indexOf(document.activeElement as HTMLButtonElement);
  const next = nextRadioIndex(event.key, current, radios.length);
  if (next === null) {
    return;
  }
  event.preventDefault();
  const target = radios[next];
  target?.focus();
  target?.click();
}

export function Tray({
  tool,
  onTool,
  onUndo,
  onClear,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  return (
    <div className="well sc-tray" role="toolbar" aria-label="Drawing tools">
      <div className="sc-tray__row">
        <div className="sc-tools" role="radiogroup" aria-label="Tool" onKeyDown={onRadioKeyDown}>
          {TOOLS.map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={tool.mode === mode}
              aria-label={label}
              tabIndex={tool.mode === mode ? 0 : -1}
              className="lamp sc-tool"
              onClick={() => onTool({ ...tool, mode })}
            >
              {icon}
            </button>
          ))}
        </div>
        <span className="sc-tray__gap" />
        <button type="button" className="key key--icon" aria-label="Undo" onClick={onUndo}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
          </svg>
        </button>
        {/* In the outcome red, because it wipes your partner's work as well as yours. */}
        <button type="button" className="key key--icon key--danger" aria-label="Clear the napkin" onClick={onClear}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h16" />
            <path d="M10 11v6M14 11v6" />
            <path d="M6 7l1 13h10l1-13" />
            <path d="M9 7V4h6v3" />
          </svg>
        </button>
      </div>
      {/*
       * The size row is the pencil (and the eraser, which draws in the same
       * strokes) expanding to show its brush sizes — a flood fill has no
       * size, so offering one there would be a control that does nothing.
       */}
      {tool.mode !== "fill" ? (
        <div className="sc-sizes" role="radiogroup" aria-label="Size" onKeyDown={onRadioKeyDown}>
          {SIZE_ORDER.map((size) => {
            const diameter = SIZES[size] as number;
            return (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={tool.size === size}
                aria-label={SIZE_NAMES[size]}
                tabIndex={tool.size === size ? 0 : -1}
                className="lamp sc-size"
                onClick={() => onTool({ ...tool, size })}
              >
                <span style={{ width: Math.max(diameter * 0.8 + 2, 4), height: Math.max(diameter * 0.8 + 2, 4) }} />
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="sc-inks" role="radiogroup" aria-label="Ink" onKeyDown={onRadioKeyDown}>
        {TRAY_INKS.map((ink) => (
          <button
            key={ink}
            type="button"
            role="radio"
            // The chosen ink reads as chosen whatever the tool is, including
            // while erasing — it's the ink the pencil hands back, and hiding
            // it there left no way to see which one that would be.
            aria-checked={tool.ink === ink}
            aria-label={NAMES[ink]}
            tabIndex={tool.ink === ink ? 0 : -1}
            className={`lamp sc-ink sc-ink--${ink}`}
            onClick={() => onTool({ ...tool, ink, mode: tool.mode === "eraser" ? "pen" : tool.mode })}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
