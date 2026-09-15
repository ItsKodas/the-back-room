export interface Turn {
  drawers: string[];
  picker: string;
  /** Which team is drawing, or null for everyone for themselves. */
  team: number | null;
}

export function soloTurn(seatId: string): Turn {
  return { drawers: [seatId], picker: seatId, team: null };
}

/**
 * A team's k-th turn: members k and k+1, wrapping.
 *
 * The first-listed drawer picks. Because the pair walks round the team, every
 * member is first-listed exactly once every n turns — so the pick is shared
 * evenly by construction, where alternating it between the pair would hand a
 * team of three's middle member the pick twice as often as the others.
 */
export function teamTurn(members: readonly string[], k: number, team: number): Turn {
  const size = members.length;
  if (size === 0) {
    throw new Error("A team with nobody in it has no turn.");
  }
  const first = members[k % size] as string;
  if (size === 1) {
    return { drawers: [first], picker: first, team };
  }
  return { drawers: [first, members[(k + 1) % size] as string], picker: first, team };
}

export function smallestTeam(sizes: readonly number[]): number {
  let best = 0;
  sizes.forEach((size, index) => {
    if (size < (sizes[best] as number)) {
      best = index;
    }
  });
  return best;
}

/** Whether one more on `team` keeps every team within one of every other. */
export function mayJoin(sizes: readonly number[], team: number): boolean {
  const after = sizes.map((size, index) => (index === team ? size + 1 : size));
  return (after[team] as number) - Math.min(...after) <= 1;
}
