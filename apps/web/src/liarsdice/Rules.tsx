import type { Bid } from "@backroom/game-liars-dice";
import { countWords, says } from "@backroom/game-liars-dice";

export const RULES_SHEET_ID = "liars-rules";

/**
 * The two prices a bid on this table can be paid at, worked out from the bid
 * actually standing rather than left as the formulas that produce them.
 *
 * Whichever face the standing bid is on has a *real* price: the least a raise
 * over it can cost, using the direction that bid is already in. The other
 * face's price is not something anybody has actually been asked to pay — no
 * one has bid ones over a plain standing bid, or vice versa — so it is
 * chained from the real one (the least that would beat a bid of the real
 * price) rather than doubled from the standing count directly. Doubling the
 * standing count regardless of its own face gives a number nobody would ever
 * be asked for: it prices beating a hypothetical bid of ones at the standing
 * bid's own count, which is only the actual rule when the standing bid
 * really is on ones.
 */
function figuresFor(standing: Bid): { halved: number; doubled: number } {
  if (standing.face === 1) {
    const doubled = standing.count * 2 + 1;
    return { doubled, halved: Math.ceil(doubled / 2) };
  }
  const halved = Math.ceil(standing.count / 2);
  return { halved, doubled: halved * 2 + 1 };
}

/**
 * The aces arithmetic, which is the one thing a player has to be told.
 *
 * Everything else at this table can be shown: whose turn it is, what the bid
 * is, what a die shows. Why "two ones" beats "four sixes" cannot be, so it is
 * written down — with the row that applies to the bid actually on the table lit,
 * and the actual figures worked out rather than left as Q and 2Q+1.
 */
export function Rules({ standing }: { standing: Bid | null }) {
  const onOnes = standing !== null && standing.face === 1;
  const onPlain = standing !== null && standing.face !== 1;
  const figures = standing === null ? null : figuresFor(standing);

  return (
    <div className="ld__rules">
      <p className="ld__rules-lead">
        Everybody rolls under a cup. Say how many of a face are on the whole
        table — yours and everybody else's — and the next player has to say
        something bigger, or call you.
      </p>

      <dl className="ld__moves">
        <dt>Raise</dt>
        <dd>More dice, or the same number at a higher face.</dd>
        <dt>Liar</dt>
        <dd>
          Every cup comes up. If the count is there, you lose a die. If it is
          not, the bidder does.
        </dd>
        <dt>Exact</dt>
        <dd>
          A claim that the count is precisely the bid. Right, and everybody else
          loses a die. Wrong, and you lose one.
        </dd>
      </dl>

      <p className="ld__rules-wild">
        <strong>Ones are wild</strong> — a one counts as whatever face was bid,
        unless ones are what was bid. That makes a bid on ones harder to fill, so
        it is dearer to say:
      </p>

      <ul className="ld__ruleset">
        <li className={`ld__rule${onPlain ? " ld__rule--on" : ""}`}>
          Over a plain face: more of anything, or{" "}
          {figures === null ? "half as many ones, rounded up" : says({ count: figures.halved, face: 1 })}.
        </li>
        <li className={`ld__rule${onOnes ? " ld__rule--on" : ""}`}>
          Over ones: more ones, or{" "}
          {figures === null
            ? "twice as many plus one of a plain face"
            : `${countWords(figures.doubled)} of a plain face`}
          .
        </li>
      </ul>

      <p className="ld__rules-foot">
        Lose your last die and you are out. The last one holding dice takes the
        pot.
      </p>
    </div>
  );
}
