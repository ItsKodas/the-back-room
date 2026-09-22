import type { Placed, SpotId } from "@backroom/game-baccarat";
import { SPOTS } from "@backroom/game-baccarat";
import { ChipStack } from "../chips/ChipStack.js";

/**
 * The betting cloth: three spots, and nothing to aim.
 *
 * Roulette's cloth turns a pointer position into one of a hundred and
 * fifty-odd bets, which is why it needs its own geometry file. This table
 * takes three, so each spot is simply its own big target — a shape that is
 * also, for free, the one the brief asks for: thumb-sized at 375px without
 * any layout arithmetic at all.
 */
export function Cloth({
  placed,
  mine,
  won,
  pushed,
  disabled,
  room,
  onPlace,
  onTake,
}: {
  placed: readonly Placed[];
  /** Which seat is yours, so your chips can be told from everybody else's. */
  mine: string | null;
  /** The spot the coup came in on, once it has. Null while nothing has settled. */
  won: SpotId | null;
  /** The coup was a tie: Player and Banker money comes home, having neither won nor lost. */
  pushed: boolean;
  disabled: boolean;
  /** What a spot can still take, worked out exactly as the bank works it out. */
  room: (spotId: SpotId) => number;
  onPlace: (spotId: SpotId) => void;
  onTake: (spotId: SpotId) => void;
}): JSX.Element {
  /* Everybody's chips, gathered per spot so one pile stands for one bet. */
  const piles = new Map<SpotId, { chips: number; yours: number }>();
  for (const one of placed) {
    const spotId = one.spotId as SpotId;
    const already = piles.get(spotId) ?? { chips: 0, yours: 0 };
    piles.set(spotId, {
      chips: already.chips + one.chips,
      yours: already.yours + (one.seatId === mine ? one.chips : 0),
    });
  }

  return (
    <div className="bc__cloth" role="group" aria-label="The betting cloth">
      {SPOTS.map((spot) => {
        const pile = piles.get(spot.id) ?? { chips: 0, yours: 0 };
        /*
         * Capped separately from the table-wide `disabled`. A spot the bank
         * cannot cover any further is closed on its own, whatever else is
         * open — greying it out here is what lets somebody see the cap
         * before they find it by being refused.
         */
        const capped = room(spot.id) === 0;
        const isWon = won === spot.id;
        const isPushed = pushed && !isWon;

        return (
          <button
            key={spot.id}
            type="button"
            className={`bc__spot bc__spot--${spot.id}${
              disabled || capped ? " bc__spot--shut" : ""
            }${isWon ? " bc__spot--won" : ""}${isPushed ? " bc__spot--pushed" : ""}`}
            /*
             * Not the native `disabled` attribute: a browser that refuses
             * focus and pointer events on a disabled button would also
             * refuse the right-click that takes chips back off a spot that
             * is only closed because it is full, and those chips are still
             * somebody's to reclaim.
             */
            aria-disabled={disabled || capped}
            aria-label={`${spot.label}, pays ${spot.pays}${
              pile.chips > 0 ? `, ${pile.chips} on it` : ""
            }`}
            onClick={() => {
              if (!disabled && !capped) {
                onPlace(spot.id);
              }
            }}
            onContextMenu={(event) => {
              // The browser's own menu is never what somebody wants over a chip.
              event.preventDefault();
              if (!disabled) {
                onTake(spot.id);
              }
            }}
          >
            <span className="bc__spot-label">{spot.label}</span>
            <span className="bc__spot-pays">{spot.pays}</span>
            {pile.chips > 0 ? (
              <span className={`bc__spot-pile${pile.yours > 0 ? " bc__spot-pile--yours" : ""}`}>
                <ChipStack amount={pile.chips} width={22} most={3} tallest={3} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
