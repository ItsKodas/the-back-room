import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { compact, exact } from "../game/money.js";
import { type Board, type BoardRow, ranked } from "../leaderboard/board.js";
import { useSlide } from "../leaderboard/useSlide.js";

/**
 * Whether the first answer from the server has been heard from yet, and if
 * so what it was. "loading" is not "signed out" — it is the state a slow
 * connection sits in for however long the round trip takes, and the one
 * fact the card is never allowed to guess at is somebody's own sign-in
 * status.
 */
type Phase = "loading" | "out" | "in";

/**
 * How many places the rail lists. The board itself carries a hundred; a rail
 * beside the room is a glance, and the full board is one press away.
 */
export const RAIL_PLACES = 25;

/**
 * Who is ahead, down the side of the room.
 *
 * The top of the board, live, with your own place pinned under it when you
 * are not already in it. Signed out it says so and still links through: a
 * page you cannot see yet is better than a page you never learn is there.
 * While still waiting on the first reply it says only that it is waiting,
 * rather than guessing "signed out" and taking it back a moment later.
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
    // The clock the server's budget for this route was sized against.
    const timer = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  // Ranked over the whole board before it is cut, so a tie that straddles the
  // cut still shares the number the board gives it.
  const places = phase === "in" && board !== null ? ranked(board.rows, board.sort).slice(0, RAIL_PLACES) : [];
  const you = board?.you ?? null;
  const below = you !== null && !places.some(({ row }) => row.id === you.row.id) ? you : null;
  const slide = useSlide(places.map(({ row }) => row));
  const chipsWere = useChipsWere(places.map(({ row }) => row));

  return (
    <section className="standings">
      <header className="standings__head">
        <span className="standings__title">Who's ahead</span>
        <Link className="key key--icon" to="/leaderboard" aria-label="Full board" title="Full board">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </Link>
      </header>
      {phase === "in" && you !== null && board !== null ? (
        <span className="standings__you">
          {/* `total` is an estimate and can lag your own exact rank; a
              reader's own standing must never be able to say "12 of 8". */}
          You are {you.rank} of {exact(Math.max(board.total, you.rank))}
        </span>
      ) : null}
      {phase === "loading" ? (
        // Asked, heard nothing back yet: a fact about sign-in the card is not
        // allowed to guess at, so this is a wait rather than an empty card.
        <span className="standings__note">Counting.</span>
      ) : phase === "out" ? (
        <span className="standings__note">Sign in to see who's ahead.</span>
      ) : (
        <div className="standings__list" ref={slide}>
          <ol>
            {places.map(({ row, rank }) => (
              <Place key={row.id} row={row} rank={rank} mine={row.id === you?.row.id} was={chipsWere.get(row.id)} />
            ))}
          </ol>
          {below !== null ? (
            <ol className="standings__below">
              <Place row={below.row} rank={below.rank} mine was={undefined} />
            </ol>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * Each row's chips as they stood on the previous answer.
 *
 * Read during render and written after it, so a row knows it changed on the
 * one render where it did. A row nobody had seen before has no previous
 * figure, and a first load moves nothing: every row appearing at once is not
 * news about any of them.
 */
function useChipsWere(rows: BoardRow[]): Map<string, number> {
  const was = useRef(new Map<string, number>());
  const seen = was.current;
  useEffect(() => {
    was.current = new Map(rows.map((row) => [row.id, row.chips]));
  });
  return seen;
}

function Place({ row, rank, mine, was }: { row: BoardRow; rank: number; mine: boolean; was: number | undefined }) {
  const moved = was === undefined || was === row.chips ? "" : row.chips > was ? " standings__chips--up" : " standings__chips--down";
  return (
    <li className={`standings__place${mine ? " standings__place--you" : ""}`} data-id={row.id}>
      <b>{rank}</b>
      <Avatar name={row.name} avatar={row.avatar} accentColor={row.accentColor} className="standings__face" />
      <span className="standings__name">{row.name}</span>
      {/* Keyed on the figure so a change remounts it and the flash plays once
          per change, rather than toggling a class that would not replay. */}
      <span key={row.chips} className={`standings__chips${moved}`} title={`${exact(row.chips)} chips`}>
        {compact(row.chips)}
      </span>
    </li>
  );
}
