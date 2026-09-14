import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../game/Avatar.js";
import { Digits } from "../game/Digits.js";
import { compact, exact } from "../game/money.js";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "../nav/Navbar.js";
import { COLUMNS, pinned, ranked, winRate } from "./board.js";
import type { Board, BoardRow, BoardSort } from "./board.js";
import { useSlide } from "./useSlide.js";

/**
 * Who is ahead.
 *
 * The one page in the building that prints other people's balances, which is
 * why it is behind a sign-in and why it says so rather than showing an empty
 * board to somebody who is not.
 */
export function Leaderboard() {
  const account = useAccount();
  const [sort, setSort] = useState<BoardSort>("chips");
  const [board, setBoard] = useState<Board | null>(null);
  const [shut, setShut] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/leaderboard?sort=${sort}`, { credentials: "include" });
    if (response.status === 401) {
      setShut(true);
      return;
    }
    if (!response.ok) {
      // A board that will not answer keeps whatever it last said, rather than
      // replacing everybody with an error nobody can act on.
      return;
    }
    setShut(false);
    setBoard((await response.json()) as Board);
  }, [sort]);

  useEffect(() => {
    const tick = () => {
      void load().catch(() => {
        // Same as above: the last answer is better than no answer.
      });
    };
    tick();
    // The same ten seconds the room refreshes its busyness on: the page is
    // already in that rhythm, and a board rarely changes faster than that.
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <main className="room">
      <Navbar account={account} />
      <p className="room__label">Who's ahead</p>
      {shut ? (
        <p className="panel__note">Sign in to see who's ahead.</p>
      ) : board === null ? (
        <p className="panel__note">Counting.</p>
      ) : (
        <BoardTable board={board} sort={sort} onSort={setSort} you={account.profile?.id ?? null} />
      )}
    </main>
  );
}

function BoardTable({
  board,
  sort,
  onSort,
  you,
}: {
  board: Board;
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  you: string | null;
}) {
  const below = pinned(board);
  const slide = useSlide(board.rows);

  return (
    <div className="board" ref={slide}>
      <div className="board__head">
        {COLUMNS.map((column) => (
          <button
            key={column.sort}
            type="button"
            className={`board__sort${sort === column.sort ? " board__sort--on" : ""}`}
            aria-pressed={sort === column.sort}
            onClick={() => onSort(column.sort)}
          >
            {column.label}
          </button>
        ))}
      </div>

      {ranked(board.rows, board.sort).map((entry) => (
        <Row key={entry.row.id} row={entry.row} rank={entry.rank} mine={entry.row.id === you} />
      ))}

      {below === null ? null : (
        <>
          {/* The distance said out loud rather than closed up: a board that
              quietly renumbers you into the last place on the page is lying.
              `total` is an estimate and can lag `rows.length`, which would
              otherwise print a negative gap. */}
          <p className="board__gap">…{exact(Math.max(0, board.total - board.rows.length))} more</p>
          <Row row={below.row} rank={below.rank} mine />
        </>
      )}

      <p className="board__note">
        Chips staked has only been counted since the board opened, so it starts at nothing for
        everybody.
      </p>
    </div>
  );
}

function Row({ row, rank, mine }: { row: BoardRow; rank: number; mine: boolean }) {
  const rate = winRate(row.stats);
  const losses = row.stats.games - row.stats.wins;

  return (
    <div className={`board__row${mine ? " board__row--you" : ""}`} data-id={row.id}>
      <b className="board__rank">{rank}</b>
      <span className="board__who">
        <Avatar name={row.name} avatar={row.avatar} accentColor={row.accentColor} className="board__face" />
        <span className="board__name">{row.name}</span>
      </span>
      <span className="board__chips" title={`${exact(row.chips)} chips`}>
        <Digits value={compact(row.chips)} />
      </span>
      {/* One flex row rather than four grid areas: the card layout wraps them
          as a unit, and a single element is one thing to reflow instead of
          four that all have to agree on the same area. */}
      <span className="board__figures">
        <span className="board__figure">
          <b>{rate}%</b>
          <small>win rate</small>
        </span>
        <span className="board__figure">
          <b>
            {row.stats.wins}–{losses}
          </b>
          <small>W–L</small>
        </span>
        <span className="board__figure">
          <b
            className={row.stats.chipsWon < 0 ? "board__down" : "board__up"}
            title={`${row.stats.chipsWon >= 0 ? "+" : ""}${exact(row.stats.chipsWon)} chips`}
          >
            {row.stats.chipsWon >= 0 ? "+" : ""}
            {compact(row.stats.chipsWon)}
          </b>
          <small>net</small>
        </span>
        <span className="board__figure">
          <b title={`${exact(row.stats.chipsStaked)} chips`}>{compact(row.stats.chipsStaked)}</b>
          <small>staked</small>
        </span>
      </span>
    </div>
  );
}
