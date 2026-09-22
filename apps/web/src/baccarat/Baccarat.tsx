import type { Outcome, SpotId, TableView } from "@backroom/game-baccarat";
import { CHIPS, headroom, toBets, WINDOWS } from "@backroom/game-baccarat";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chip } from "../chips/Chip.js";
import { Avatar } from "../game/Avatar.js";
import { Chat } from "../game/Chat.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useCountdown } from "../game/useCountdown.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { BeadPlate } from "./BeadPlate.js";
import { Cloth } from "./Cloth.js";
import { Coup } from "./Coup.js";
import { shownAt as fullyRevealed, useReveal } from "./reveal.js";
import { useCoupSound } from "./useCoupSound.js";
import { usePendingChips } from "./usePendingChips.js";
import { Winners } from "./Winners.js";
import "@backroom/game-baccarat/theme.css";
import "./baccarat.css";

/**
 * The baccarat table, wired up.
 *
 * Roulette's shape, not blackjack's — the design doc's own claim, and this
 * page is the proof of it: the same `useTableSocket` wiring, the same
 * `TableSetup` lobby, the same felt-then-boards-then-controls-then-seats
 * layout, because a table with no turns in it is a wheel with a shoe standing
 * in for the ball.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

const OUTCOME_LABEL: Record<Outcome, string> = {
  player: "Player wins",
  banker: "Banker wins",
  tie: "Tie",
};

export function Baccarat() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/baccarat"), [navigate]);
  const table = useTableSocket<TableView>("baccarat", back, account.setChips);
  const { state, seatId } = table;

  useNav({
    room: "baccarat",
    game: "Baccarat",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            /*
             * Asked while bets are open and something is down, the same as
             * roulette: chips on the cloth are already in the bank, and
             * standing up gives them up. Not asked once the shoe has
             * answered — nothing is owed to a seat that leaves after that,
             * and the reveal does not need them in the room.
             */
            confirm: state.phase === "betting" && (state.you?.staked ?? 0) > 0,
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/baccarat/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    /*
     * Just "play", not a variant like poker's or roulette's: baccarat.css
     * caps its grid at the column's own width on purpose (three spots is
     * plenty on a phone), so there is no wider felt for a "play--felt"
     * modifier to unlock, and no stylesheet has ever defined one.
     */
    <main className="play">
      {table.error !== null ? <p className="play__error">{table.error}</p> : null}

      {/*
        A second window on the same game is turned away, and says so in its
        own panel rather than as a disconnection — one seat per player, for
        the same reason roulette turns a second window away.
      */}
      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        <>
          <Felt table={table} state={state} seatId={seatId} />
          <Chat log={table.chat} seatId={seatId} onSay={table.say} />
        </>
      )}
    </main>
  );
}

/* -------------------------------------------------------------- the felt */

export function Felt({
  table,
  state,
  seatId,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
}) {
  const [chip, setChip] = useState<number>(CHIPS[CHIPS.length - 1]);

  /*
   * What each spot can still take, worked out here exactly as the bank works
   * it out. Shown, never enforced — the table refuses the message either way.
   * Without it, a player learns the cap by being refused, which is a worse
   * way to find out than seeing a spot already greyed out.
   */
  const bets = useMemo(() => toBets(state.placed), [state.placed]);
  const room = useCallback((spotId: SpotId) => headroom(state.bank, bets, spotId), [state.bank, bets]);

  const mine = state.you;
  const canBet = state.phase === "betting" && !state.lastCall && mine !== null;

  /*
   * Why the last press did nothing.
   *
   * The cap is the server's and it refuses in words, but the felt does not
   * send a chip it already knows is too big — which left a press that did
   * nothing at all and said nothing either. An empty bank looked exactly like
   * a broken table: every chip silently ignored, everything else normal.
   */
  const [refused, setRefused] = useState<string | null>(null);

  /*
   * A stake is a number this player chose, so it goes down on the press —
   * CLAUDE.md's own bargain, and the one this table was missing: watched live
   * against the old code, a clicked spot stayed empty for the whole of an
   * artificially delayed round trip. The table's own figure always wins once
   * it catches up; this only ever *stands in* for it before then.
   *
   * Substituted, not added: this player's own entries on a pending spot are
   * dropped from the cloth and replaced by the one pending total for it, so
   * the same chip is never counted under both this player's own press and
   * the table's own word for the same spot at once.
   */
  const { pending, add: addPending, retire: retirePending } = usePendingChips(
    state.placed,
    seatId,
    table.error,
    table.errorKey,
  );
  const displayPlaced = useMemo(() => {
    if (seatId === null || Object.keys(pending).length === 0) {
      return state.placed;
    }
    const withoutMineOnPendingSpots = state.placed.filter(
      (one) => !(one.seatId === seatId && one.spotId in pending),
    );
    const standingIn = Object.entries(pending).map(([spotId, chips]) => ({
      seatId,
      spotId,
      chips,
    }));
    return [...withoutMineOnPendingSpots, ...standingIn];
  }, [state.placed, pending, seatId]);

  const place = (spotId: SpotId) => {
    if (!canBet) {
      return;
    }
    const most = room(spotId);
    if (chip > most) {
      setRefused(
        most === 0
          ? "The bank cannot cover a bet there yet."
          : `The bank covers ${fmt(most)} on that at the moment.`,
      );
      return;
    }
    setRefused(null);
    addPending(spotId, chip);
    table.act({ type: "place", spotId, chips: chip });
  };

  /*
   * The reveal, live only while there is something left to reveal.
   *
   * `useReveal` reads its position from `deadline` and `dealMs` together —
   * `deadline - dealMs` is when dealing began — which only holds while
   * `deadline` is still timing the deal. Once the coup is settled, `deadline`
   * has moved on to timing the six-second read instead, and asking
   * `useReveal` to keep counting against it would run `elapsed` backwards
   * from the deal's own length: exactly the kind of invented fact the reveal
   * machinery exists to prevent. So settled reads the finished schedule
   * directly — every card the coup has is already out and turned by
   * then — and betting, where there is no coup at all, gets nothing.
   */
  const live = useReveal(
    state.phase === "dealing" ? state.coup : null,
    state.deadline,
    state.dealMs,
  );
  const shown =
    state.phase === "settled" && state.coup !== null
      ? fullyRevealed(state.coup, state.dealMs)
      : live;

  /*
   * The outcome, only once the table has actually said so.
   *
   * `state.coup.outcome` is in the payload from the moment betting closes —
   * the shoe has already answered by then, because baccarat has no decisions
   * left to make once the bets are in — but showing it before the coup is
   * settled would be exactly the "never invent a fact" failure this file
   * exists to avoid: a lit spot is the answer, several seconds early. `Outcome`
   * and `SpotId` share the same three strings on purpose, so the one value
   * tells both the cloth and the hands which side to light.
   */
  const revealed: Outcome | null = state.phase === "settled" ? (state.coup?.outcome ?? null) : null;

  useCoupSound(
    state.phase === "dealing" ? state.coup : null,
    state.deadline,
    state.dealMs,
  );

  return (
    <section className="bc" data-game="baccarat">
      <Standing state={state} refused={refused} />

      <div className="bc__table">
        <Coup shown={shown} outcome={revealed} />
        <Cloth
          placed={displayPlaced}
          mine={seatId}
          won={revealed}
          pushed={revealed === "tie"}
          disabled={!canBet}
          room={room}
          onPlace={place}
          onTake={(spotId) => {
            if (canBet) {
              // The press this cancels stops standing in for the table, or
              // the chip just taken off goes back on until the timer fires.
              retirePending(spotId);
              table.act({ type: "take", spotId, chips: chip });
            }
          }}
        />
      </div>

      {/* The two boards, together: what the shoe has been doing, and what it
          has been worth to the people sitting at it. */}
      <div className="bc__boards">
        <BeadPlate outcomes={state.history} />
        <Winners winners={state.winners} />
      </div>

      {mine === null ? (
        <p className="bc__watching">{state.watching} watching. Take a seat to play.</p>
      ) : (
        <Controls
          table={table}
          state={state}
          chip={chip}
          onChip={setChip}
          onTakeBack={retirePending}
        />
      )}

      <Seats state={state} seatId={seatId} />
      {state.forFun && mine !== null ? <Bots table={table} /> : null}
    </section>
  );
}

/**
 * Somebody to play, when there is nobody — the whole reason bots exist here.
 *
 * Only at a table playing for nothing, and only once you are actually
 * seated: a bot fills a chair beside you, not a spot for somebody who has
 * not sat down yet. The lobby already promises this ("you can deal bots
 * in."); the server has always allowed it (`Table.addBot`), but nothing here
 * ever called it.
 */
function Bots({ table }: { table: Table }) {
  return (
    <div className="bc__bots">
      <span className="bc__bots-label">Deal somebody in</span>
      {(["easy", "normal", "hard"] as const).map((skill) => (
        <button
          key={skill}
          type="button"
          className="bc__bot"
          disabled={table.busy}
          onClick={() => table.addBot(skill)}
        >
          {skill}
        </button>
      ))}
    </div>
  );
}

/**
 * What the table is doing, and how long it is doing it for.
 *
 * The one line everybody at the table reads. A betting window with no clock
 * on it is a window that shuts while somebody is still deciding.
 */
function Standing({ state, refused }: { state: TableView; refused?: string | null }) {
  const left = useCountdown(state.deadline);

  /*
   * A bank with nothing in it is said before anybody presses anything.
   *
   * This table pays from chips other players staked, and a new one has none
   * until an admin floats it — so "nothing can be bet here" is a fact about
   * the table, not a refusal of your press, and it belongs on screen while
   * you are still deciding rather than after you have tried.
   */
  if (state.phase === "betting" && state.bank <= 0) {
    return (
      <p className="bc__standing bc__standing--last" role="status">
        The bank is empty — nothing to play for yet.
      </p>
    );
  }

  if (refused != null && state.phase === "betting") {
    return (
      <p className="bc__standing bc__standing--last" role="status">
        {refused}
      </p>
    );
  }

  if (state.phase === "dealing") {
    return <p className="bc__standing bc__standing--shut">No more bets.</p>;
  }
  if (state.phase === "settled") {
    return (
      <p className="bc__standing" role="status">
        {state.coup === null ? "" : `${OUTCOME_LABEL[state.coup.outcome]}. `}Paying out.
      </p>
    );
  }
  return (
    <p className={`bc__standing${state.lastCall ? " bc__standing--last" : ""}`} role="status">
      {state.lastCall ? "Last call" : "Place your bets"}
      {left === null ? "" : ` — ${left}s`}
    </p>
  );
}

/** The tray, and the two ways to take a chip back. */
function Controls({
  table,
  state,
  chip,
  onChip,
  onTakeBack,
}: {
  table: Table;
  state: TableView;
  chip: number;
  onChip: (value: number) => void;
  /**
   * Both of these take chips off, and neither says which spot: Undo is
   * whatever the table put down last, and Clear is the lot. So they give up
   * every pending figure this seat is holding rather than one spot's.
   */
  onTakeBack: () => void;
}) {
  const open = state.phase === "betting" && !state.lastCall;
  const down = state.you?.staked ?? 0;
  const purse = state.you?.purse ?? null;

  return (
    <div className="bc__controls">
      <div className="bc__tray" role="radiogroup" aria-label="What to bet with">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chip === value}
            aria-label={`Bet with ${fmt(value)}`}
            className={`bc__chip${chip === value ? " bc__chip--picked" : ""}`}
            disabled={purse !== null && value > purse}
            onClick={() => onChip(value)}
          >
            <Chip amount={value} />
          </button>
        ))}
      </div>

      {/*
        Three buttons, all the same weight — roulette's own reasoning, carried
        over whole: one of them spends money, and lighting it up the way a
        primary action is usually lit would be the felt leaning on the player.
      */}
      <div className="bc__acts">
        <button
          type="button"
          className="bc__act"
          /* Written out, not left to how the two spans happen to sit: a name
             and a note with nothing between them read as one run-on word. */
          aria-label="Put last round's chips down again"
          disabled={!open || !state.canRepeat || table.busy}
          onClick={() => table.act({ type: "repeat" })}
        >
          <span className="bc__act-name">Same again</span>
          <span className="bc__act-note">Last round's chips</span>
        </button>
        <button
          type="button"
          className="bc__act"
          aria-label="Undo the last chip you put down"
          disabled={!open || down === 0 || table.busy}
          onClick={() => {
            onTakeBack();
            table.act({ type: "undo" });
          }}
        >
          <span className="bc__act-name">Undo</span>
          <span className="bc__act-note">The last chip down</span>
        </button>
        <button
          type="button"
          className="bc__act"
          aria-label="Take back everything you have on the cloth"
          disabled={!open || down === 0 || table.busy}
          onClick={() => {
            onTakeBack();
            table.act({ type: "clear" });
          }}
        >
          <span className="bc__act-name">Clear</span>
          <span className="bc__act-note">Everything you have on</span>
        </button>
      </div>

      <p className="bc__note">
        {down > 0 ? (
          <>
            <strong className="bc__note-figure">{fmt(down)}</strong> on the cloth.{" "}
          </>
        ) : null}
        {purse === null ? null : (
          <>
            <strong className="bc__note-figure">{fmt(purse)}</strong> in play money left.{" "}
          </>
        )}
        Right-click a chip, or press and hold, to take it back off.
      </p>
    </div>
  );
}

/** Everybody at the table, and what the last coup did to them. */
function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ul className="bc__seats">
      {state.seats.map((seat) => {
        const paid = state.paid.find((one) => one.seatId === seat.id);
        const up = paid === undefined ? null : paid.back - paid.staked;
        return (
          <li
            key={seat.id}
            className={`bc__seat${seat.id === seatId ? " bc__seat--you" : ""}${
              seat.connected ? "" : " bc__seat--away"
            }`}
          >
            <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
            <span className="bc__seat-name">{seat.name}</span>
            {seat.staked > 0 ? <span className="bc__seat-down">{fmt(seat.staked)}</span> : null}
            {up === null || state.phase !== "settled" ? null : (
              <span className={`bc__seat-up${up >= 0 ? "" : " bc__seat-up--down"}`}>
                {up >= 0 ? `+${fmt(up)}` : fmt(up)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------- the lobby */

function Sit({
  table,
  invited,
  account,
}: {
  table: Table;
  invited: string;
  account: Account;
}) {
  const [window, setWindow] = useState<number>(WINDOWS[1]);

  return (
    <TableSetup
      game="baccarat"
      pitch="Player or banker, and which side gets closer to nine. The table pays from a bank that players alone fill, so nothing is won here that somebody put in."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{ fun: "Play money, and you can deal bots in. Anybody can sit down." }}
      options={
        /*
         * How long the shoe takes bets for. A decision about everybody's
         * evening rather than one player's, the same way roulette's spin
         * window is — so it belongs to the host, with the rest of the
         * table's shape.
         */
        <div className="stakes" role="radiogroup" aria-label="How long bets stay open">
          <span className="stakes__label">Betting</span>
          <div className="stakes__row">
            {WINDOWS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={window === level}
                aria-label={`${level / 1000} seconds a coup`}
                className={`stakes__pick${window === level ? " stakes__pick--on" : ""}`}
                onClick={() => setWindow(level)}
              >
                <span className="stakes__cost">{level / 1000}s</span>
              </button>
            ))}
          </div>
        </div>
      }
      note={({ forFun }) =>
        `You get a five-character code to share. The shoe comes round on its own every ${window / 1000} seconds${
          forFun
            ? ", with play money that lives at the table."
            : ", and chips leave your balance as they land on the cloth."
        }`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "baccarat", forFun, maxSeats, window })
      }
    />
  );
}

export default Baccarat;
