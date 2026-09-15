import type { DiceSkin, Die as DieFace } from "@backroom/rules";

/** Pip positions per face, as [row, column] on a 3x3 grid. */
const PIPS: Record<DieFace, ReadonlyArray<readonly [number, number]>> = {
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

/**
 * The letter edition, face for face. Faces 4 and 5 are both E — that is the
 * point of them, and the colour is what tells them apart. `$GREED` needs one of
 * each, so the two must never be drawn the same.
 */
export const LETTERS: Record<DieFace, string> = {
  1: "$",
  2: "G",
  3: "R",
  4: "E",
  5: "E",
  6: "D",
};

/**
 * The gem each face is named for on the printed table, which is also the
 * colour its letter is printed in. The two Es are the ones that carry a rule —
 * a straight needs one of each — but every face wears its own, so a roll can be
 * read by colour before it is read by letter.
 */
export const GEM: Record<DieFace, string> = {
  1: "silver",
  2: "gold",
  3: "ruby",
  4: "ebony",
  5: "emerald",
  6: "diamond",
};

/** Spoken form, so the die still reads correctly to a screen reader. */
const LETTER_NAMES: Record<DieFace, string> = {
  1: "dollar",
  2: "G",
  3: "R",
  4: "black E",
  5: "green E",
  6: "D",
};

interface DieProps {
  face: DieFace;
  skin: DiceSkin;
  held: boolean;
  dead: boolean;
  /** True while the dice are tumbling and the faces shown are not real yet. */
  rolling: boolean;
  /** Position in the tray, used to stagger the tumble and the reveal. */
  index: number;
  /** True during the $GREED celebration. */
  celebrating: boolean;
  /** False for spectators and when it is not your turn. */
  interactive: boolean;
  onClick: () => void;
}

export function Die({
  face,
  skin,
  held,
  dead,
  rolling,
  index,
  celebrating,
  interactive,
  onClick,
}: DieProps) {
  const letters = skin === "letters";
  const classes = [
    "die",
    held ? "die--held" : "",
    dead ? "die--dead" : "",
    rolling ? "die--rolling" : "",
    celebrating ? "die--greed" : "",
  ]
    .filter((name) => name.length > 0)
    .join(" ");

  const shown = letters ? LETTER_NAMES[face] : String(face);

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={dead || !interactive}
      aria-pressed={held}
      aria-label={
        rolling
          ? "Rolling"
          : `Die showing ${shown}${held ? ", set aside" : ""}${dead ? ", cannot score" : ""}`
      }
      // Each die lands, and later reveals, a beat after the one before it.
      style={
        rolling || celebrating
          ? { animationDelay: `${index * (celebrating ? 110 : 40)}ms` }
          : undefined
      }
    >
      {letters ? (
        <span className={`die__letter die__letter--${GEM[face]}`}>{LETTERS[face]}</span>
      ) : (
        PIPS[face].map(([row, column]) => (
          <span
            className="die__pip"
            key={`${row}-${column}`}
            style={{ gridRow: row, gridColumn: column }}
          />
        ))
      )}
    </button>
  );
}
