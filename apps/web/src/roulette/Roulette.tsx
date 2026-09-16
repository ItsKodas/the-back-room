import type { TableView } from "@backroom/game-roulette";
import { CHIPS, headroom, SPIN_MS, spotAt, toBets, WINDOWS } from "@backroom/game-roulette";
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
import { Cloth } from "./Cloth.js";
import { History } from "./History.js";
import { Wheel } from "./Wheel.js";
import { Winners } from "./Winners.js";
import "@backroom/game-roulette/theme.css";
import "./roulette.css";

/**
 * The roulette table, wired up.
 *
 * Built on the same components the mockup in /style is drawn with, so the
 * table that was looked at and the table that spins are the same table. What
 * is added here is everything the mockup could not have: a wheel told where
 * the ball went by the server, chips that are somebody's, and a window that
 * shuts on its own.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

export function Roulette() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/roulette"), [navigate]);
  const table = useTableSocket<TableView>("roulette", back, account.setChips);
  const { state, seatId } = table;

  useNav({
    room: "roulette",
    game: "Roulette",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            /*
             * Asked twice while the window is open, because chips on the
             * cloth are already in the bank and standing up gives them up.
             * Not asked once the wheel is turning: nothing is owed to a
             * seat that leaves then, and the spin does not need them.
             */
            confirm: state.phase === "betting" && (state.you?.staked ?? 0) > 0,
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/roulette/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    // Wider only at the cloth: the screen before it is the building's width.
    <main className={state === null ? "play" : "play play--wheel"}>

      {table.error !== null ? <p className="play__error">{table.error}</p> : null}

      {/*
        A second window on the same game is turned away, and says so in its own
        panel rather than as a disconnection — one wheel per player, because
        two of them would be one person betting against their own table.
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
   * The pocket, but only once the ball is in it.
   *
   * The view carries the result all through the spin, because the wheel needs
   * it to roll the ball to the right place. Everything else must wait: a lit
   * square on the cloth is the answer, several seconds early.
   */
  const turning = state.phase === "spinning";
  const landed = turning ? null : state.pocket;

  /*
   * What each spot can still take, worked out here exactly as the server works
   * it out. Shown, never enforced — the table refuses the message either way.
   * Without it a player learns the cap by being refused, which is a worse way
   * to find out.
   */
  const bets = useMemo(() => toBets(state.placed), [state.placed]);
  const room = useCallback(
    (spotId: string) => {
      const spot = spotAt(spotId);
      return spot === null ? 0 : headroom(state.bank, bets, spot);
    },
    [state.bank, bets],
  );

  const mine = state.you;
  const canBet = state.phase === "betting" && !state.lastCall && mine !== null;

  /* Which pockets your own chips cover, so the wheel can mark them. */
  const covered = useMemo(() => coveredBy(state, seatId), [state, seatId]);

  /*
   * Why the last press did nothing.
   *
   * The cap is the server's and it refuses in words, but the felt does not
   * send a chip it already knows is too big — which left a press that did
   * nothing at all and said nothing either. An empty bank looked exactly like
   * a broken table: every chip silently ignored, everything else normal.
   */
  const [refused, setRefused] = useState<string | null>(null);

  const place = (spotId: string) => {
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
    table.act({ type: "place", spotId, chips: chip });
  };

  return (
    <section className="rl" data-game="roulette">
      <Standing state={state} refused={refused} />

      <div className="rl__table">
        <div className="rl__wheel-holds">
          <Wheel
            pocket={state.pocket}
            spinning={turning}
            spinMs={SPIN_MS}
            covered={covered}
          />
        </div>
        <Cloth
          placed={state.placed}
          mine={seatId}
          landed={landed}
          disabled={!canBet}
          onPlace={place}
          onTake={(spotId) => {
            if (canBet) {
              table.act({ type: "take", spotId, chips: chip });
            }
          }}
        />
      </div>

      {/* The two boards, together: what the wheel has been doing, and what it
          has been worth to the people sitting at it. */}
      <div className="rl__boards">
        <History pockets={state.history} />
        <Winners winners={state.winners} />
      </div>

      {mine === null ? (
        <p className="rl__watching">{state.watching} watching. Take a seat to play.</p>
      ) : (
        <Controls table={table} state={state} chip={chip} onChip={setChip} />
      )}

      <Seats state={state} seatId={seatId} />
    </section>
  );
}

/** Which pockets this seat's own chips cover, so the wheel can mark them. */
function coveredBy(state: TableView, seatId: string | null): Set<number> {
  const out = new Set<number>();
  for (const one of state.placed) {
    if (one.seatId !== seatId) {
      continue;
    }
    for (const pocket of spotAt(one.spotId)?.covers ?? []) {
      out.add(pocket);
    }
  }
  return out;
}

/**
 * What the table is doing, and how long it is doing it for.
 *
 * The one line everybody at the table reads. A betting window with no clock on
 * it is a window that shuts while somebody is still deciding.
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
      <p className="rl__standing rl__standing--last" role="status">
        The bank is empty — nothing to play for yet.
      </p>
    );
  }

  if (refused != null && state.phase === "betting") {
    return (
      <p className="rl__standing rl__standing--last" role="status">
        {refused}
      </p>
    );
  }

  if (state.phase === "spinning") {
    return <p className="rl__standing rl__standing--shut">No more bets.</p>;
  }
  if (state.phase === "settled") {
    return (
      <p className="rl__standing" role="status">
        {state.pocket === null ? "" : `${state.pocket}.`} Paying out.
      </p>
    );
  }
  return (
    <p className={`rl__standing${state.lastCall ? " rl__standing--last" : ""}`} role="status">
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
}: {
  table: Table;
  state: TableView;
  chip: number;
  onChip: (value: number) => void;
}) {
  const open = state.phase === "betting" && !state.lastCall;
  const down = state.you?.staked ?? 0;
  const purse = state.you?.purse ?? null;

  return (
    <div className="rl__controls">
      <div className="rl__tray" role="radiogroup" aria-label="What to bet with">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chip === value}
            aria-label={`Bet with ${fmt(value)}`}
            className={`rl__chip${chip === value ? " rl__chip--picked" : ""}`}
            disabled={purse !== null && value > purse}
            onClick={() => onChip(value)}
          >
            <Chip amount={value} />
          </button>
        ))}
      </div>

      {/*
        Three buttons, all the same weight.

        One of them spends money — "same again" puts a whole round back down —
        and lighting it up the way a primary action is usually lit would be the
        felt leaning on the player. The same reason poker's raise stopped being
        the bright one.
      */}
      <div className="rl__acts">
        <button
          type="button"
          className="rl__act"
          /* Written out, not left to how the two spans happen to sit: a name
             and a note with nothing between them read as one run-on word. */
          aria-label="Put last round's chips down again"
          disabled={!open || !state.canRepeat || table.busy}
          onClick={() => table.act({ type: "repeat" })}
        >
          <span className="rl__act-name">Same again</span>
          <span className="rl__act-note">Last round's chips</span>
        </button>
        <button
          type="button"
          className="rl__act"
          aria-label="Undo the last chip you put down"
          disabled={!open || down === 0 || table.busy}
          onClick={() => table.act({ type: "undo" })}
        >
          <span className="rl__act-name">Undo</span>
          <span className="rl__act-note">The last chip down</span>
        </button>
        <button
          type="button"
          className="rl__act"
          aria-label="Take back everything you have on the cloth"
          disabled={!open || down === 0 || table.busy}
          onClick={() => table.act({ type: "clear" })}
        >
          <span className="rl__act-name">Clear</span>
          <span className="rl__act-note">Everything you have on</span>
        </button>
      </div>

      <p className="rl__note">
        {down > 0 ? (
          <>
            <strong className="rl__note-figure">{fmt(down)}</strong> on the cloth.{" "}
          </>
        ) : null}
        {purse === null ? null : (
          <>
            <strong className="rl__note-figure">{fmt(purse)}</strong> in play money left.{" "}
          </>
        )}
        Right-click a chip, or press and hold, to take it back off.
      </p>
    </div>
  );
}

/** Everybody at the table, and what the last spin did to them. */
function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ul className="rl__seats">
      {state.seats.map((seat) => {
        const paid = state.paid.find((one) => one.seatId === seat.id);
        const up = paid === undefined ? null : paid.back - paid.staked;
        return (
          <li
            key={seat.id}
            className={`rl__seat${seat.id === seatId ? " rl__seat--you" : ""}${
              seat.connected ? "" : " rl__seat--away"
            }`}
          >
            <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
            <span className="rl__seat-name">{seat.name}</span>
            {seat.staked > 0 ? <span className="rl__seat-down">{fmt(seat.staked)}</span> : null}
            {up === null || state.phase !== "settled" ? null : (
              <span className={`rl__seat-up${up >= 0 ? "" : " rl__seat-up--down"}`}>
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
      game="roulette"
      pitch="One wheel, thirty-seven pockets, everybody at once. The table pays from a bank that players alone fill, so nothing is won here that somebody put in."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{ fun: "Play money, and you can deal bots in. Anybody can sit down." }}
      options={
        /*
         * How long the wheel takes bets for. A decision about everybody's
         * evening rather than one player's — fifteen seconds and a minute are
         * different games to sit at — so it belongs to the host, with the rest
         * of the table's shape.
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
                aria-label={`${level / 1000} seconds a spin`}
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
        `You get a five-character code to share. The wheel comes round on its own every ${window / 1000} seconds${
          forFun
            ? ", with play money that lives at the table."
            : ", and chips leave your balance as they land on the cloth."
        }`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "roulette", forFun, maxSeats, window })
      }
    />
  );
}

export default Roulette;
