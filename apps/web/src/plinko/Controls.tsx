import type { Risk } from "@backroom/game-plinko";
import { exact } from "../game/money.js";
import { Seg } from "../fittings/Seg.js";
import { double, fit, halve, nudge } from "./stake.js";

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
      <button type="button" className="slab pk-controls__drop" disabled={!canDrop} onClick={onDrop}>
        Drop · {exact(stake)}
      </button>
      <p className="pk-controls__why" role="status">
        {why ?? ""}
      </p>
    </div>
  );
}
