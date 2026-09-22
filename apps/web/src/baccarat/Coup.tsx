import type { Outcome } from "@backroom/game-baccarat";
import { useEffect, useState } from "react";
import { useBumped } from "../blackjack/useIntent.js";
import { Card, FaceDown } from "../cards/Cards.js";
import type { Shown } from "./reveal.js";

/**
 * The two hands, as they stand at this instant of the reveal.
 *
 * Everything here is driven off `Shown` and nothing keeps its own clock: the
 * felt does not know or care whether a card just came out of the shoe or a
 * browser opened mid-coup and is seeing it for the first time, because
 * `shownAt` already answered that question the same way either way.
 */

/** Half of the fold-then-open a card does when it turns in place. */
const FOLD_MS = 120;

export function Coup({
  shown,
  outcome,
}: {
  shown: Shown | null;
  outcome: Outcome | null;
}): JSX.Element {
  return (
    <div className="bc__coup">
      <Hand
        side="player"
        label="Player"
        slots={shown?.player ?? []}
        total={shown?.playerTotal ?? null}
        won={outcome === "player"}
      />
      <Hand
        side="banker"
        label="Banker"
        slots={shown?.banker ?? []}
        total={shown?.bankerTotal ?? null}
        won={outcome === "banker"}
      />
    </div>
  );
}

function Hand({
  side,
  label,
  slots,
  total,
  won,
}: {
  side: "player" | "banker";
  label: string;
  slots: Shown["player"];
  total: number | null;
  /** Only ever true once the table has actually said so — see below. */
  won: boolean;
}): JSX.Element {
  // A tick when the total appears at all, coalesced to "" while there is
  // none: the first real number after that is a total made true by a card
  // landing, which is exactly what a tick is for.
  const ticked = useBumped(total ?? "");

  return (
    <div className={`bc__hand bc__hand--${side}${won ? " bc__hand--won" : ""}`}>
      <span className="bc__hand-label">{label}</span>
      <span className="bc__hand-cards">
        {slots.map((slot, index) => (
          // A hand only ever grows at its end, so position is a stable identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: a hand is append-only
          <Place key={index} slot={slot} deal={index} />
        ))}
      </span>
      {total === null ? null : (
        <span className={`bc__hand-total${ticked ? " bc__hand-total--ticked" : ""}`}>{total}</span>
      )}
    </div>
  );
}

/**
 * One place in a hand.
 *
 * A slot arrives face down and, when the table turns it, plays through
 * exactly the two motions the deck's own back-then-face pair is built from:
 * the back folds away and the face opens out in its place. Doing that here,
 * rather than switching straight from `FaceDown` to `Card` the moment `turned`
 * flips, is what keeps it one motion across a change of identity instead of a
 * face popping in over a back that never moved — the crux CLAUDE.md calls
 * out by name.
 */
function Place({ slot, deal }: { slot: Shown["player"][number]; deal: number }): JSX.Element {
  const [folding, setFolding] = useState(false);
  // Once true, stays true: a slot that has been shown as a face never goes
  // back to being a mystery, even if the coup this belongs to is stale by the
  // time this unmounts.
  const [open, setOpen] = useState(slot?.turned === true);

  useEffect(() => {
    if (slot === null || !slot.turned || open) {
      return;
    }
    setFolding(true);
    const timer = window.setTimeout(() => {
      setFolding(false);
      setOpen(true);
    }, FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [slot, open]);

  if (slot === null) {
    return <FaceDown deal={deal} />;
  }
  if (!open) {
    return <FaceDown deal={deal} folding={folding} />;
  }
  return <Card card={slot.card} deal={deal} enter="unfold" />;
}
