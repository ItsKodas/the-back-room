import { CHIPS, MIN_CHIP } from "@backroom/game-roulette";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { Chip } from "../chips/Chip.js";
import { exact } from "../game/money.js";
import type { Reach } from "./said.js";
import { said } from "./said.js";

/** A typed figure, read the way the felt writes one: commas welcome and ignored. */
export function readChip(typed: string): number | null {
  const digits = typed.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
}

/** Whether a figure can go on at all: big enough, and inside the purse and the bank. */
function covers(chip: number, reach: Reach): boolean {
  return (
    chip >= MIN_CHIP && chip <= reach.most && (reach.purse === null || chip <= reach.purse)
  );
}

/**
 * What you are betting with, and what you can do about what you have already
 * bet.
 *
 * Three acts of equal weight and no lit slab, deliberately. The only one-press
 * action here spends money — "same again" puts a whole round back down — and
 * lighting it the way a primary action is usually lit would be the felt
 * leaning on the player. K1, K2 and F2 are not met, and this is why.
 */
export function Controls({
  chip,
  onChip,
  reach,
  refused,
  open,
  betting,
  down,
  canRepeat,
  busy,
  onRepeat,
  onUndo,
  onClear,
  taunt,
}: {
  chip: number;
  onChip: (value: number) => void;
  reach: Reach;
  refused: string | null;
  open: boolean;
  betting: boolean;
  down: number;
  canRepeat: boolean;
  busy: boolean;
  onRepeat: () => void;
  onUndo: () => void;
  onClear: () => void;
  taunt?: ReactNode;
}) {
  const id = useId();
  /* Half a number is nobody's business but this box's. */
  const [draft, setDraft] = useState(() =>
    CHIPS.includes(chip as (typeof CHIPS)[number]) ? "" : exact(chip),
  );
  const typed = readChip(draft);
  /* The chip held is a figure of the player's own, which no key here is. */
  const ownHeld = !CHIPS.includes(chip as (typeof CHIPS)[number]);
  /* And it is the figure in the box, rather than one typed over it since. */
  const holding = ownHeld && typed === chip;

  const betOwn = () => {
    if (busy || typed === null || !covers(typed, reach)) {
      return;
    }
    setDraft(exact(typed));
    onChip(typed);
  };

  return (
    <div className="rl__controls">
      <div className="rl__tray" role="radiogroup" aria-label="What to bet with">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chip === value}
            aria-label={`Bet with ${exact(value)}`}
            className={`key rl__chip${chip === value ? " rl__chip--picked" : ""}`}
            /* The chip held never goes dark: it is already on, and a cap that
               moved under it is not the same as being unable to cover it. */
            disabled={chip !== value && reach.purse !== null && value > reach.purse}
            onClick={() => onChip(value)}
          >
            <Chip amount={value} />
          </button>
        ))}
      </div>

      <div className="rl__own" data-held={ownHeld || undefined}>
        <label className="rl__own-label" htmlFor={`${id}-own`}>
          Custom chip
        </label>
        <input
          id={`${id}-own`}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          aria-label="Custom chip"
          placeholder={reach.most >= MIN_CHIP ? `${exact(MIN_CHIP)} – ${exact(reach.most)}` : "Nothing covered"}
          value={draft}
          disabled={busy || !betting}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d,]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              betOwn();
            }
          }}
          onBlur={() => setDraft(typed === null ? "" : exact(typed))}
        />
        {/* Latches like a key, because it is one: the box holds a figure, and
            this is what puts it on. Nothing is bet on a keystroke — typing a
            thousand goes through a one and a ten on the way. */}
        <button
          type="button"
          className="key rl__own-set"
          aria-pressed={holding}
          disabled={!holding && (busy || typed === null || !covers(typed, reach))}
          onClick={holding ? undefined : betOwn}
        >
          {holding ? "Held" : "Bet it"}
        </button>
      </div>

      <div className="rl__acts">
        <button
          type="button"
          className="key rl__act"
          /* Written out, not left to how the two spans happen to sit: a name
             and a note with nothing between them read as one run-on word. */
          aria-label="Put last round's chips down again"
          aria-keyshortcuts="R"
          disabled={!open || !canRepeat || busy}
          onClick={onRepeat}
        >
          <span className="rl__act-name">Same again</span>
          <span className="rl__act-note">Last round's chips</span>
        </button>
        <button
          type="button"
          className="key rl__act"
          aria-label="Undo the last chip you put down"
          aria-keyshortcuts="U"
          disabled={!open || down === 0 || busy}
          onClick={onUndo}
        >
          <span className="rl__act-name">Undo</span>
          <span className="rl__act-note">The last chip down</span>
        </button>
        <button
          type="button"
          className="key rl__act"
          aria-label="Take back everything you have on the cloth"
          aria-keyshortcuts="C"
          disabled={!open || down === 0 || busy}
          onClick={onClear}
        >
          <span className="rl__act-name">Clear</span>
          <span className="rl__act-note">Everything you have on</span>
        </button>
        {taunt}
      </div>

      {/* What is down, and what is left — a standing fact, not news, so it
          carries no aria-live of its own. */}
      <p className="rl__note">
        {down > 0 ? (
          <>
            <strong className="rl__note-figure">{exact(down)}</strong> on the cloth.{" "}
          </>
        ) : null}
        {reach.purse === null ? null : (
          <>
            <strong className="rl__note-figure">{exact(reach.purse)}</strong> in play money left.{" "}
          </>
        )}
        Right-click a chip, or press and hold, to take it back off.
      </p>

      {/*
        aria-live rather than role="status": Standing in Roulette.tsx already
        carries the page's one role="status", and a second status region would
        make the one that actually announces something impossible to ask for
        by role alone. The same call plinko/Controls.tsx makes about its own
        figure, for the same reason.
      */}
      <p className="rl__said" aria-live="polite">
        {said({ reach, chip, typed, holding, refused, betting })}
      </p>
    </div>
  );
}
