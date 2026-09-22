import type { Face } from "@backroom/game-liars-dice";

/** Pip positions per face, as [row, column] on a 3x3 grid. */
const PIPS: Record<Face, ReadonlyArray<readonly [number, number]>> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

const NAMES: Record<Face, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
};

/**
 * One die.
 *
 * A `span` rather than a button, unlike Greed's: nothing is ever done to a die
 * at this table. You bid about them.
 *
 * A `null` face is not a die whose face we are choosing not to draw — it is a
 * die whose face nobody has been told, which is the truth for everybody else's
 * cup until somebody pays to see it. Drawing a guess and correcting it later
 * would be inventing a fact.
 */
export function Die({
  face,
  index,
  matched = false,
  dying = false,
}: {
  face: Face | null;
  /** Position in the hand, which staggers the landing and the turn-over. */
  index: number;
  /** Lit because the count is about this die. */
  matched?: boolean;
  /** On its way out of somebody's hand. */
  dying?: boolean;
}) {
  const hidden = face === null;
  const classes = [
    "ld-die",
    hidden ? "ld-die--down" : "",
    matched ? "ld-die--matched" : "",
    dying ? "ld-die--dying" : "",
  ]
    .filter((name) => name.length > 0)
    .join(" ");

  return (
    <span
      className={classes}
      role="img"
      aria-label={hidden ? "Face down" : `Showing ${NAMES[face]}`}
      // Each die lands, and later turns over, a beat after the one before it.
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {hidden
        ? null
        : PIPS[face].map(([row, column]) => (
            <span
              className="ld-die__pip"
              key={`${row}-${column}`}
              style={{ gridRow: row, gridColumn: column }}
            />
          ))}
    </span>
  );
}

/**
 * Somebody's dice in a row.
 *
 * `matched` is the face a bid was about, and lights the dice that answer to it
 * — ones included, unless ones were what was bid. The wild rule is the one
 * thing a reveal has to make obvious, and lighting the dice is how.
 */
export function Hand({
  dice,
  matched = null,
  dying = false,
  label,
}: {
  dice: readonly (Face | null)[];
  matched?: Face | null;
  dying?: boolean;
  label: string;
}) {
  return (
    <span className="ld__hand" role="group" aria-label={label}>
      {dice.map((face, at) => (
        <Die
          // Dice have no identity of their own: position in the hand is the
          // only thing that distinguishes two fives, and it is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
          key={at}
          face={face}
          index={at}
          matched={
            matched !== null &&
            face !== null &&
            (face === matched || (matched !== 1 && face === 1))
          }
          dying={dying && at === dice.length - 1}
        />
      ))}
    </span>
  );
}
