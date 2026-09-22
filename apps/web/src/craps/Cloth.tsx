import type { Placed } from "@backroom/game-craps";
import { spotAt } from "@backroom/game-craps";
import { useEffect, useRef, useState } from "react";
import { ChipStack } from "../chips/ChipStack.js";
import { type Box, TALL, TURNS_AT, WIDE, boxFor, oddsSpotFor, slot } from "./layout.js";

/**
 * The betting cloth.
 *
 * Roulette needs a coordinate hit-test because a chip can sit on the line
 * between two squares. Craps has no split bets at all — every bet on this
 * table is its own named spot — so a box is a `<button>` and a press is a
 * click on it. That is simpler than aiming, and it is a real target with a
 * real hit area rather than a guess about where a thumb landed.
 */
export function Cloth({
  placed,
  mine,
  onPlace,
  onTake,
  disabled = false,
  point,
  offByBank,
  odds,
  landedOn,
  full,
  portrait,
}: {
  placed: readonly Placed[];
  /** Which seat is yours, so your chips can be told from everybody else's. */
  mine: string | null;
  onPlace?: (spotId: string) => void;
  /**
   * Takes chips back off a box.
   *
   * Right-click, which is the other half of placing by pressing: the pointer
   * is already over the chip you mean, so reaching for a button to undo it is
   * a journey away from the thing you are looking at. A long press does the
   * same, because a phone has no second button — browsers raise the same
   * context-menu event for both, which is why one handler covers it.
   */
  onTake?: (spotId: string) => void;
  disabled?: boolean;
  point: number | null;
  /** Which spots the bank could not carry this roll, so the felt can say so. */
  offByBank: readonly string[];
  /** Whether a press lays odds behind rather than on. */
  odds: boolean;
  /**
   * The boxes this roll lit, once the dice have stopped — box ids, as
   * `boxFor` returns them, not the spot ids a bet is placed with.
   *
   * Named for the thing that has happened rather than for the value, because
   * the value exists long before it: the server decides the dice the moment
   * betting seals and sends them so they can be *thrown* to. Passing that
   * through here while they are still in the air lights the winning box
   * several seconds early and gives the result away.
   */
  landedOn: readonly string[] | null;
  /**
   * The boxes the bank has no room left on — box ids, the same as `landedOn`.
   *
   * Still pressable, deliberately. Greying one out says "not this one" at a
   * glance; leaving the press alive is what lets the felt answer *why* when
   * somebody tries it anyway, and a control that is dimmed and dead says
   * neither. The cap is the server's either way.
   */
  full?: readonly string[];
  /** Forces the arrangement. Left off, the cloth works it out for itself. */
  portrait?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);

  /*
   * Which way round the cloth goes, decided by the cloth from its own width.
   *
   * Its own width rather than the viewport's, because this is a question
   * about the room it was given and not about the device: the same cloth is
   * narrow beside a rail on a desk and wide on a tablet held sideways. Below
   * the threshold a landscape cloth gives boxes too small for a thumb, never
   * mind legibility.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const cloth = box.current;
    if (cloth === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) {
        setNarrow(width < TURNS_AT);
      }
    });
    watch.observe(cloth);
    return () => watch.disconnect();
  }, []);

  const sideways = portrait ?? narrow;
  const arrangement = sideways ? TALL : WIDE;

  /* Everybody's chips, gathered per box so a box draws only what is on it. */
  const stacksByBox = new Map<string, Placed[]>();
  for (const one of placed) {
    const id = boxFor(one.spotId);
    if (id === null) {
      continue;
    }
    const already = stacksByBox.get(id);
    if (already === undefined) {
      stacksByBox.set(id, [one]);
    } else {
      already.push(one);
    }
  }

  return (
    <div
      className={`cr__cloth${disabled ? " cr__cloth--shut" : ""}`}
      role="group"
      aria-label="The betting cloth"
      ref={box}
      style={{
        gridTemplateColumns: `repeat(${arrangement.cols}, 1fr)`,
        gridAutoRows: "minmax(0, 1fr)",
        aspectRatio: `${arrangement.cols} / ${arrangement.rows}`,
      }}
    >
      {arrangement.boxes.map((one) => (
        <ClothBox
          key={one.id}
          box={one}
          stacks={stacksByBox.get(one.id) ?? []}
          mine={mine}
          disabled={disabled}
          point={point}
          offByBank={offByBank}
          odds={odds}
          lit={landedOn?.includes(one.id) ?? false}
          full={full?.includes(one.id) ?? false}
          onPlace={onPlace}
          onTake={onTake}
          placed={placed}
        />
      ))}
    </div>
  );
}

/**
 * One box, as a button.
 *
 * Its own component rather than inlined in the map above, because a box does
 * three separate jobs — names itself, holds up to five stacks, and decides
 * whether it can take odds — and folding all three into one large arrow
 * function is where a slot number and a chip count start getting mixed up.
 */
function ClothBox({
  box,
  stacks,
  mine,
  disabled,
  point,
  offByBank,
  odds,
  lit,
  full,
  onPlace,
  onTake,
  placed,
}: {
  box: Box;
  stacks: readonly Placed[];
  mine: string | null;
  disabled: boolean;
  point: number | null;
  offByBank: readonly string[];
  odds: boolean;
  lit: boolean;
  full: boolean;
  onPlace?: (spotId: string) => void;
  onTake?: (spotId: string) => void;
  placed: readonly Placed[];
}) {
  const spot = spotAt(box.id);
  const label = spot?.label ?? box.id;
  const isPoint = point !== null && box.id === `place:${point}`;
  const canOdds = odds && eligibleForOdds(box.id, placed, mine, point);

  return (
    <button
      type="button"
      className="cr__box"
      style={{
        gridColumn: `${box.x + 1} / span ${box.w}`,
        gridRow: `${box.y + 1} / span ${box.h}`,
      }}
      aria-label={label}
      disabled={disabled}
      // The bet's own family, from spots.ts rather than guessed from the box id
      // a second time, so the felt can tint pass/field/prop/place apart without
      // a classification of ids that can drift from the one bets.ts already has.
      data-kind={spot?.kind}
      data-point={isPoint || undefined}
      data-odds={canOdds || undefined}
      data-lit={lit || undefined}
      data-full={full || undefined}
      onClick={() => onPlace?.(box.id)}
      onContextMenu={(event) => {
        // The browser's own menu is never what somebody wants over a chip.
        event.preventDefault();
        if (disabled) {
          return;
        }
        onTake?.(box.id);
      }}
    >
      <span className="cr__box-label">{label}</span>
      {stacks.map((one) => (
        <span
          key={`${one.seatId}|${one.spotId}`}
          className="cr__stack"
          data-slot={slot(one.spotId)}
          data-mine={one.seatId === mine || undefined}
        >
          {/*
           * `tallest={5}` keeps every pile in this box to one column, so the
           * viewBox `ChipStack` draws stays the same width whatever the
           * stake is — see roulette's identical note on its own `.stack`
           * rule. `tallest={3}` here split a four-chip bet into two columns
           * and the fixed-width clamp below then drew it at half the size of
           * a three-chip one: the money got smaller the more of it there was.
           */}
          <ChipStack amount={one.chips} width={22} most={5} tallest={5} />
          {/*
           * A colour that merely changes is one somebody has to already know
           * the meaning of. This says the word.
           */}
          {one.off ? (
            <span
              className={`cr__off${offByBank.includes(one.spotId) ? " cr__off--bank" : ""}`}
            >
              Off
            </span>
          ) : null}
        </span>
      ))}
    </button>
  );
}

/**
 * Whether a box could take odds laid behind what `mine` already has down.
 *
 * Asked of `oddsSpotFor` rather than answered again here, because the answer
 * has to be the same one the felt sends when the box is pressed. Outlining a
 * box by one rule and placing by another is a box that lights up for a bet
 * the table then refuses.
 */
function eligibleForOdds(
  boxId: string,
  placed: readonly Placed[],
  mine: string | null,
  point: number | null,
): boolean {
  return oddsSpotFor(boxId, placed, mine, point) !== null;
}
