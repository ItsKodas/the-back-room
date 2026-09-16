import type { Ink } from "@backroom/game-scribble";
import { INKS, SIZES } from "@backroom/game-scribble";
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

const SIZE_NAMES = ["Fine", "Medium", "Thick"];

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
      <div className="sc-inks" role="radiogroup" aria-label="Ink">
        {TRAY_INKS.map((ink) => (
          <button
            key={ink}
            type="button"
            role="radio"
            aria-checked={tool.mode !== "eraser" && tool.ink === ink}
            aria-label={NAMES[ink]}
            className={`lamp sc-ink sc-ink--${ink}`}
            onClick={() => onTool({ ...tool, ink, mode: tool.mode === "eraser" ? "pen" : tool.mode })}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="sc-tray__row">
        <div className="sc-tray__group" role="radiogroup" aria-label="Size">
          {SIZES.map((diameter, size) => (
            <button
              key={diameter}
              type="button"
              role="radio"
              aria-checked={tool.size === size}
              aria-label={SIZE_NAMES[size]}
              className="lamp sc-size"
              onClick={() => onTool({ ...tool, size })}
            >
              <span style={{ width: diameter * 0.8 + 2, height: diameter * 0.8 + 2 }} />
            </button>
          ))}
        </div>
        <span className="sc-tray__gap" />
        <button
          type="button"
          className="key key--icon"
          aria-label="Fill"
          aria-pressed={tool.mode === "fill"}
          onClick={() => onTool({ ...tool, mode: tool.mode === "fill" ? "pen" : "fill" })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 13 11 6l7 7-7 7z" />
            <path d="M8 3l3 3" />
            <path d="M19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z" />
          </svg>
        </button>
        <button
          type="button"
          className="key key--icon"
          aria-label="Eraser"
          aria-pressed={tool.mode === "eraser"}
          onClick={() => onTool({ ...tool, mode: tool.mode === "eraser" ? "pen" : "eraser" })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16 4l5 5-10 10H6l-3-3z" />
            <path d="M11 9l5 5" />
            <path d="M9 20h12" />
          </svg>
        </button>
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
    </div>
  );
}
