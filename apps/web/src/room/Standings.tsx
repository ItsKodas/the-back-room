import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { compact, exact } from "../game/money.js";
import { type Board, ranked } from "../leaderboard/board.js";

/**
 * Whether the first answer from the server has been heard from yet, and if
 * so what it was. "loading" is not "signed out" — it is the state a slow
 * connection sits in for however long the round trip takes, and the one
 * fact the card is never allowed to guess at is somebody's own sign-in
 * status.
 */
type Phase = "loading" | "out" | "in";

/**
 * Who is ahead, from the front door.
 *
 * The top three and your own place, which is the whole of what somebody wants
 * to know without opening the board. Signed out it says so and still links
 * through: a page you cannot see yet is better than a page you never learn is
 * there. While still waiting on the first reply it says only that it is
 * waiting, rather than guessing "signed out" and taking it back a moment
 * later, or leaving an empty card under the heading.
 */
export function Standings() {
  const [board, setBoard] = useState<Board | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let live = true;
    const load = () => {
      void fetch("/api/leaderboard", { credentials: "include" })
        .then(async (response) => {
          if (!live) {
            return;
          }
          if (response.status === 401) {
            setPhase("out");
            return;
          }
          if (response.ok) {
            setBoard((await response.json()) as Board);
            setPhase("in");
          }
          // Any other status is neither an answer nor a refusal: keep
          // whatever the last poll established rather than inventing one.
        })
        .catch(() => {
          // The last answer is better than an error nobody can act on.
        });
    };
    load();
    // The same clock the room's busyness is on.
    const timer = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link className="standings" to="/leaderboard">
      {phase === "loading" ? (
        // Asked, heard nothing back yet: a fact about sign-in the card is not
        // allowed to guess at, so this is a wait rather than an empty card.
        <span className="standings__note">Counting.</span>
      ) : phase === "out" ? (
        <span className="standings__note">Sign in to see who's ahead.</span>
      ) : phase === "in" && board !== null ? (
        <>
          <ol className="standings__top">
            {/* Ranked the same way the board ranks: ties share a place there,
                so they have to share one here or the two pages disagree. */}
            {ranked(board.rows, board.sort)
              .slice(0, 3)
              .map(({ row, rank }) => (
                <li key={row.id} className="standings__place">
                  <b>{rank}</b>
                  <Avatar
                    name={row.name}
                    avatar={row.avatar}
                    accentColor={row.accentColor}
                    className="standings__face"
                  />
                  <span className="standings__name">{row.name}</span>
                  <span className="standings__chips" title={`${exact(row.chips)} chips`}>
                    {compact(row.chips)}
                  </span>
                </li>
              ))}
          </ol>
          {board.you === null ? null : (
            <p className="standings__you">
              {/* `total` is an estimate and can lag your own exact rank; a
                  reader's own standing must never be able to say "12 of 8". */}
              You are {board.you.rank} of {exact(Math.max(board.total, board.you.rank))}
            </p>
          )}
        </>
      ) : null}
    </Link>
  );
}
