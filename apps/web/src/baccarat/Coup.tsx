import type { Outcome } from "@backroom/game-baccarat";
import { useEffect, useState } from "react";
import { useBumped } from "../blackjack/useIntent.js";
import { Card, FaceDown, FOLD_MS } from "../cards/Cards.js";
import type { Shown } from "./reveal.js";

/**
 * The two hands, as they stand at this instant of the reveal.
 *
 * Everything here is driven off `Shown` and nothing keeps its own clock: the
 * felt does not know or care whether a card just came out of the shoe or a
 * browser opened mid-coup and is seeing it for the first time, because
 * `shownAt` already answered that question the same way either way.
 */

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
          <Place key={index} slot={slot} />
        ))}
      </span>
      {total === null ? null : (
        <span className={`bc__hand-total${ticked ? " bc__hand-total--ticked" : ""}`}>{total}</span>
      )}
    </div>
  );
}

/**
 * One place in a hand, once the shoe has actually dealt it.
 *
 * A slot arrives face down and, when the table turns it, plays through
 * exactly the two motions the deck's own back-then-face pair is built from:
 * the back folds away and the face opens out in its place. Doing that here,
 * rather than switching straight from `FaceDown` to `Card` the moment `turned`
 * flips, is what keeps it one motion across a change of identity instead of a
 * face popping in over a back that never moved — the crux CLAUDE.md calls
 * out by name.
 *
 * Nothing at all before then. A place a card has not reached yet drawn as a
 * back is the same picture as a card that is out, so the whole deal would
 * arrive in one frame and the schedule's stagger would never be seen — and a
 * hand that goes on to draw a third card would stand three deep from the
 * start, which says its pair totals five or less well before the table does.
 *
 * No `deal` stagger either: `Cards.tsx` offsets a card by its position in the
 * hand because a blackjack hand arrives all at once, and here the schedule is
 * the stagger. Delaying a card past its own `outAt` would put it behind the
 * shoe sound that `useCoupSound` fires at that same moment.
 */
function Place({ slot }: { slot: Shown["player"][number] }): JSX.Element | null {
  const [folding, setFolding] = useState(false);
  // Once true, stays true: a slot that has been shown as a face never goes
  // back to being a mystery, even if the coup this belongs to is stale by the
  // time this unmounts.
  const [open, setOpen] = useState(slot?.turned === true);

  /*
   * What actually identifies this slot, as opposed to the object `shownAt`
   * happened to wrap it in.
   *
   * `useReveal` calls `shownAt` fresh on every animation frame, so the real
   * caller hands this component a brand-new `slot` object roughly every
   * 16ms even when nothing about the deal has changed. Depending on that
   * object below would restart the fold timer on every one of those frames
   * — long before its 120ms could ever elapse — and no card would visibly
   * turn until the frames stopped coming. `turned`, `rank` and `suit` are
   * the only things about a slot that ever change, and a card's rank and
   * suit never do once it has been dealt into this slot, so together they
   * are stable across the churn in exactly the way the object is not.
   */
  const turned = slot?.turned === true;
  const rank = slot?.card.rank;
  const suit = slot?.card.suit;

  // biome-ignore lint/correctness/useExhaustiveDependencies: rank and suit are not read in the body, but naming this slot rather than merely its turned state is the whole fix — see the comment above.
  useEffect(() => {
    if (!turned || open) {
      return;
    }
    setFolding(true);
    const timer = window.setTimeout(() => {
      setFolding(false);
      setOpen(true);
    }, FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [turned, rank, suit, open]);

  if (slot === null) {
    return null;
  }
  if (!open) {
    return <FaceDown folding={folding} />;
  }
  return <Card card={slot.card} enter="unfold" />;
}
