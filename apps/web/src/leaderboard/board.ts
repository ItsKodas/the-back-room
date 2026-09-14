/**
 * The arithmetic of the board, apart from the drawing of it.
 *
 * Here rather than inside the component because none of it is about React:
 * a rank is a rank whether anybody is looking, and it is worth being able to
 * push at these without a DOM in the way.
 */

export type BoardSort = "chips" | "net" | "staked" | "games" | "wins";

export interface BoardRow {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: { games: number; wins: number; chipsWon: number; chipsStaked: number };
}

export interface Board {
  sort: BoardSort;
  rows: BoardRow[];
  you: { row: BoardRow; rank: number } | null;
  total: number;
}

/** The columns you can order by, in the order they are written across a row. */
export const COLUMNS: ReadonlyArray<{ sort: BoardSort; label: string }> = [
  { sort: "chips", label: "chips" },
  { sort: "net", label: "net" },
  { sort: "staked", label: "staked" },
  { sort: "games", label: "games" },
  { sort: "wins", label: "wins" },
];

/** Wins as a percentage. Nobody who has played nothing has won nothing. */
export function winRate(stats: BoardRow["stats"]): number {
  return stats.games === 0 ? 0 : Math.round((stats.wins / stats.games) * 100);
}

export function figure(row: BoardRow, sort: BoardSort): number {
  switch (sort) {
    case "chips":
      return row.chips;
    case "net":
      return row.stats.chipsWon;
    case "staked":
      return row.stats.chipsStaked;
    case "games":
      return row.stats.games;
    case "wins":
      return row.stats.wins;
  }
}

/**
 * The rank against each row, off the order the server sent.
 *
 * Ties share a number and the next one down skips the ones they used up —
 * three players second means the next is fifth. The rows are not re-sorted
 * here: the server decided the order, and a client that decided it again
 * would be a client with an opinion about who is winning.
 */
export function ranked(rows: BoardRow[], sort: BoardSort): Array<{ row: BoardRow; rank: number }> {
  let rank = 0;
  let last: number | null = null;
  return rows.map((row, index) => {
    const value = figure(row, sort);
    if (last === null || value !== last) {
      rank = index + 1;
      last = value;
    }
    return { row, rank };
  });
}

/**
 * Your own row, when the page you are looking at does not contain it.
 *
 * Null when you are already on the board, because a row printed twice reads
 * as two people. Pinning it rather than renumbering you into the last place
 * on the page: a board that quietly calls you hundredth is lying.
 */
export function pinned(board: Board): { row: BoardRow; rank: number } | null {
  if (board.you === null) {
    return null;
  }
  return board.rows.some((row) => row.id === board.you?.row.id) ? null : board.you;
}
