import type { Combo, Die, FaceScores, Ruleset } from "@backroom/rules";
import { GEM, LETTERS } from "./Die.js";

const fmt = (n: number) => n.toLocaleString("en-US");

const COUNT_WORDS: Record<number, string> = {
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
};

const title = (word: string) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;

interface Row {
  key: string;
  /** The little dice drawn beside the name, each with an id of its own. */
  dice: ReadonlyArray<{ id: string; face: Die }>;
  name: string;
  points: number;
}

function diceFor(key: string, faces: readonly Die[]): Row["dice"] {
  return faces.map((face, at) => ({ id: `${key}-${at}`, face }));
}

/** True when every face pays the same for this many, e.g. six of a kind. */
function uniform(faces: readonly FaceScores[], size: number): number | null {
  const first = faces[0]?.[size - 1] ?? 0;
  if (first === 0) {
    return null;
  }
  return faces.every((face) => (face[size - 1] ?? 0) === first) ? first : null;
}

/**
 * True when this many of a face always pays a fixed multiple of its triple.
 * The classic game does this — four, five and six of a kind are the triple
 * doubled, quadrupled and octupled — and writing that once beats eighteen rows.
 */
function multipleOfTriple(faces: readonly FaceScores[], size: number): number | null {
  let ratio: number | null = null;
  for (const face of faces) {
    const triple = face[2] ?? 0;
    const value = face[size - 1] ?? 0;
    if (triple === 0 || value === 0) {
      return null;
    }
    const candidate = value / triple;
    if (!Number.isInteger(candidate)) {
      return null;
    }
    if (ratio === null) {
      ratio = candidate;
    } else if (ratio !== candidate) {
      return null;
    }
  }
  return ratio;
}

/**
 * The rows a scored combination could be printed on, most specific last.
 * The card has only one of them for any given ruleset, so the first that
 * exists is the one to light.
 */
function rowsFor(combo: Combo): string[] {
  switch (combo.kind) {
    case "straight":
      return ["straight"];
    case "three-pairs":
      return ["pairs"];
    case "two-triplets":
      return ["triplets"];
    case "four-plus-pair":
      return ["fourpair"];
    default:
      return combo.size === 1
        ? [`single-${combo.face}`]
        : [`all-${combo.size}`, `ratio-${combo.size}`, `${combo.size}-${combo.face}`];
  }
}

/**
 * The scoring, laid out as a card.
 *
 * Read out of the ruleset rather than written down, so it is right for the
 * classic game, right for the letter dice, and right for anything a host
 * changes later. A scoring table that can disagree with the scoring is worse
 * than no table at all.
 *
 * `lit` is what the dice picked up are made of: the rows it lands on light, so
 * a player finds what they have on the card instead of working it out.
 */
export function ScoreCard({ rules, lit = [] }: { rules: Ruleset; lit?: readonly Combo[] }) {
  const letters = rules.skin === "letters";
  const faceName = (die: Die) => (letters ? LETTERS[die] : String(die));
  const rows: Row[] = [];

  if (rules.straight !== null && rules.straight > 0) {
    rows.push({
      key: "straight",
      dice: diceFor("straight", [1, 2, 3, 4, 5, 6]),
      name: letters ? "$GREED, one of each" : "A straight, 1 to 6",
      points: rules.straight,
    });
  }

  for (const size of [2, 3, 4, 5, 6]) {
    const shared = uniform(rules.faces, size);
    if (shared !== null) {
      rows.push({ key: `all-${size}`, dice: [], name: `${COUNT_WORDS[size]} of a kind`, points: shared });
      continue;
    }

    const ratio = size > 3 ? multipleOfTriple(rules.faces, size) : null;
    if (ratio !== null) {
      rows.push({
        key: `ratio-${size}`,
        dice: [],
        name: `${COUNT_WORDS[size]} of any, ${ratio}× the triple`,
        points: 0,
      });
      continue;
    }

    // Best first, the way the printed table orders its columns.
    rules.faces
      .map((face, index) => ({ die: (index + 1) as Die, points: face[size - 1] ?? 0 }))
      .filter((entry) => entry.points > 0)
      .sort((a, b) => b.points - a.points || a.die - b.die)
      .forEach(({ die, points }) => {
        const key = `${size}-${die}`;
        rows.push({
          key,
          dice: diceFor(key, Array.from({ length: Math.min(size, 4) }, () => die)),
          name: letters ? title(GEM[die]) : `${COUNT_WORDS[size]} ${die}s`,
          points,
        });
      });
  }

  if (rules.threePairs !== null && rules.threePairs > 0) {
    rows.push({ key: "pairs", dice: [], name: "Three pairs", points: rules.threePairs });
  }
  if (rules.twoTriplets !== null && rules.twoTriplets > 0) {
    rows.push({ key: "triplets", dice: [], name: "Two triplets", points: rules.twoTriplets });
  }
  if (rules.fourPlusPair !== null && rules.fourPlusPair > 0) {
    rows.push({ key: "fourpair", dice: [], name: "Four and a pair", points: rules.fourPlusPair });
  }

  // Singles last, the way the table tucks them under the rule, best first.
  rules.faces
    .map((face, index) => ({ die: (index + 1) as Die, points: face[0] ?? 0 }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points || a.die - b.die)
    .forEach(({ die, points }) => {
      const key = `single-${die}`;
      rows.push({ key, dice: diceFor(key, [die]), name: `Each ${faceName(die)}`, points });
    });

  const present = new Set(rows.map((row) => row.key));
  const lighting = new Set(
    lit.map((combo) => rowsFor(combo).find((key) => present.has(key))).filter((key) => key !== undefined),
  );

  return (
    <>
      <dl className="card table-scroll" aria-label="What everything scores">
        {rows.map((row) => (
          <div className={`card__row${lighting.has(row.key) ? " card__row--lit" : ""}`} key={row.key}>
            <dt>
              {row.dice.length > 0 ? (
                <span className="card__dice" aria-hidden="true">
                  {row.dice.map((die) => (
                    <span
                      key={die.id}
                      className={`card__die${letters ? ` card__die--${GEM[die.face]}` : ""}`}
                    >
                      {faceName(die.face)}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="card__name">{row.name}</span>
            </dt>
            <dd>{row.points > 0 ? fmt(row.points) : ""}</dd>
          </div>
        ))}
      </dl>
      <p className="card__foot">
        {rules.entryThreshold > 0 ? `${fmt(rules.entryThreshold)} in one turn to get on the board. ` : ""}
        First to {fmt(rules.targetScore)}
        {rules.finalRound ? ", then everyone else gets one last turn." : "."}
      </p>
    </>
  );
}
