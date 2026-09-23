import type { Outcome } from "@backroom/game-baccarat";

/**
 * The bead plate.
 *
 * Honest decoration. The shoe is reshuffled before every coup — CLAUDE.md's
 * own condition on a game dealt from a deck — so this predicts nothing at
 * all, the same way it predicted nothing at a real table. It stays anyway,
 * because it is the game's furniture: roulette's history strip is exactly
 * this, drawn for exactly the same reason.
 *
 * Six rows, filling column by column, the way a real one is marked — top to
 * bottom, then across. That fill order is why this is columns of cells rather
 * than one flat strip: a plain list would read left to right, and the mark
 * for coup seven would sit beside coup one instead of below coup six.
 *
 * Every mark carries its outcome as text, because the colour is not the whole
 * of what it says — a grid of coloured dots is not a board to somebody
 * reading it aloud.
 */
const ROWS = 6;

const LABEL: Record<Outcome, string> = {
  player: "Player",
  banker: "Banker",
  tie: "Tie",
};

const LETTER: Record<Outcome, string> = {
  player: "P",
  banker: "B",
  tie: "T",
};

export function BeadPlate({ outcomes }: { outcomes: readonly Outcome[] }): JSX.Element | null {
  if (outcomes.length === 0) {
    return null;
  }

  const columns: Outcome[][] = [];
  outcomes.forEach((outcome, index) => {
    const col = Math.floor(index / ROWS);
    const already = columns[col];
    if (already === undefined) {
      columns[col] = [outcome];
    } else {
      already.push(outcome);
    }
  });

  return (
    <div className="bc__bead-plate" role="group" aria-label="Recent results, oldest first">
      {columns.map((column, colIndex) => (
        // A column's position is its identity — nothing about a column that
        // has already filled ever changes once the plate has moved past it.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div className="bc__bead-col" key={colIndex}>
          {column.map((outcome, rowIndex) => {
            const index = colIndex * ROWS + rowIndex;
            const latest = index === outcomes.length - 1;
            return (
              <span
                // The same reasoning as the column above: a cell's place in
                // the fill order is what makes it the cell it is.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={rowIndex}
                className={`bc__bead bc__bead--${outcome}${latest ? " bc__bead--latest" : ""}`}
                // A role a screen reader will actually name: the letter alone
                // is a colour standing in for a word, and a generic span
                // cannot carry an accessible name on its own.
                role="img"
                aria-label={LABEL[outcome]}
              >
                {LETTER[outcome]}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
