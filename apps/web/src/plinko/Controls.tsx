import type { Risk } from "@backroom/game-plinko";
import { exact } from "../game/money.js";
import { Seg } from "../fittings/Seg.js";
import { double, fit, halve, nudge } from "./stake.js";
import { useHold } from "./useHold.js";

const RISK_OPTIONS = [
  { value: "low", text: "Low" },
  { value: "medium", text: "Medium" },
  { value: "high", text: "High" },
] as const satisfies ReadonlyArray<{ value: Risk; text: string }>;

/**
 * Risk, stake, and the one lit key. Within a thumb's reach at the foot of the
 * page, and every key big enough to hit without looking.
 *
 * `limit` is what the bank and the balance allow together; `why` is the words
 * for it when the stake is up against it, because a key that silently does
 * nothing reads as broken.
 */
export function Controls({
  risk,
  onRisk,
  stake,
  onStake,
  limit,
  why,
  canDrop,
  onDrop,
}: {
  risk: Risk;
  onRisk: (risk: Risk) => void;
  stake: number;
  onStake: (stake: number) => void;
  limit: number;
  why: string | null;
  canDrop: boolean;
  onDrop: () => void;
}) {
  // Held down, the key keeps dropping. `onDrop` is the page's own gate, so a
  // repeat that arrives with the board full or the balance short simply does
  // nothing and the next one picks up where it left off.
  const hold = useHold(onDrop);

  return (
    <div className="pk-controls">
      <Seg label="Risk" options={RISK_OPTIONS} value={risk} onChange={onRisk} />
      <div className="pk-controls__stake" role="group" aria-label="Stake">
        <button type="button" className="key" aria-label="Halve the stake" onClick={() => onStake(halve(stake))}>
          ½
        </button>
        <button type="button" className="key" aria-label="Less" onClick={() => onStake(nudge(stake, -1))}>
          −
        </button>
        {/*
         * A div, not an <output>: every other .readout in the building is one
         * (Banks.tsx, Play.tsx, Readout.tsx), and <output> carries an implicit
         * ARIA role of "status" — which would leave two status regions on this
         * screen and make the one that actually announces something (the "why"
         * line below) impossible to ask for by role alone. No aria-label of
         * its own either: a plain div's role is "generic", which does not
         * carry an accessible name, and the figure is already named by the
         * "Stake" group it sits inside.
         */}
        <div className="readout pk-controls__figure">{exact(stake)}</div>
        <button
          type="button"
          className="key"
          aria-label="More"
          onClick={() => onStake(fit(nudge(stake, 1), limit))}
        >
          +
        </button>
        <button
          type="button"
          className="key"
          aria-label="Double the stake"
          onClick={() => onStake(fit(double(stake), limit))}
        >
          2×
        </button>
      </div>
      {/* Its own click, so the building's press sound does not land under it. */}
      <button
        type="button"
        className="slab pk-controls__drop"
        data-quiet
        disabled={!canDrop}
        onPointerDown={(event) => {
          // A right-click is not a press, and neither is the middle button.
          if (event.button !== 0) return;
          hold.start();
        }}
        onPointerUp={hold.stop}
        onPointerCancel={hold.stop}
        // Sliding a thumb off the key is how you get out of a hold without
        // lifting it. Pointer capture would take that away.
        onPointerLeave={hold.stop}
        /*
         * A pointer press already dropped on the way down; the click the
         * browser sends afterwards would drop a second ball for the same
         * press. `detail: 0` is a click with no pointer behind it — Space or
         * Enter on a focused key — which is the only one left to act on.
         */
        onClick={(event) => {
          if (event.detail === 0) onDrop();
        }}
      >
        Drop · {exact(stake)}
      </button>
      <p className="pk-controls__why" role="status">
        {why ?? ""}
      </p>
    </div>
  );
}
