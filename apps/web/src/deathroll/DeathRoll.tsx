import type { SeatView, TableView } from "@backroom/game-death-roll";
import { CEILINGS, DEATH_ROLL, STAKES } from "@backroom/game-death-roll";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { play, preload, unlock } from "../game/audio.js";
import { Chat } from "../game/Chat.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useCountdown } from "../game/useCountdown.js";
import { Navbar } from "../nav/Navbar.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Falling } from "./Falling.js";
import { goesOut, moveLine, passesTo } from "./lines.js";
import type { Intent } from "./useIntent.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-death-roll/theme.css";
import "./deathroll.css";

/**
 * Death roll, wired up.
 *
 * A duel was the whole game once, and this page still draws almost nothing
 * beyond the number and the seats around it — but there are now up to six of
 * them, in an order a player has to read, so the felt gained a rail on a
 * desk, a grid on a phone, and a ready screen for the gap between games.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

export function DeathRoll() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/death-roll"), [navigate]);
  const table = useTableSocket<TableView>("death-roll", back, account.setChips);
  const { state, seatId } = table;

  useEffect(() => {
    document.documentElement.dataset["game"] = "death-roll";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/death-roll/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    <main className="play play--duel">
      <Navbar
        game="Death Roll"
        {...(state !== null
          ? {
              table: {
                code: state.code,
                onLeave: table.leave,
                // Asked while a game is running, because the ante is already
                // in the pot and standing up gives it up. Not asked once it
                // has ended: nothing more is owed to a seat that leaves then.
                confirm: state.phase === "playing",
              },
            }
          : {})}
        account={account}
        connected={table.connected}
      />

      {table.error !== null ? <p className="play__error">{table.error}</p> : null}

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
  const mine = state.you;
  const myTurn = state.phase === "playing" && seatId !== null && state.toRoll === seatId;
  const intent = useIntent(state, seatId, table.act, table.error);
  useTableSound(state, seatId);
  // A pass's chips only ever need to land once, right as they are pressed —
  // not for as long as the ask stays outstanding, which is what watching
  // `pending` itself would do.
  const justPaid = usePaidFlourish(intent.pending > 0);
  const countdown = useCountdown(state.countdownEndsAt);
  // A courtesy, not a rule: the server refuses a second pass and a roll
  // passed to you regardless of what this button shows.
  const passHidden = mine === null || mine.passed || state.passedTo === seatId;

  /*
   * What the big number ought to show. The ceiling everywhere but the one
   * moment a round ends on a 1 — the table leaves the ceiling exactly where
   * it was for that roll rather than setting it to the number that killed
   * it, so showing it here instead is the only way the felt ever says "1"
   * at all. Between games it is the opening ceiling, dimmed.
   */
  const shown =
    state.phase === "over" && state.lastRoll !== null
      ? state.lastRoll.result
      : state.phase === "waiting"
        ? state.opening
        : state.ceiling;

  const chance = goesOut(state);

  return (
    <section className="dr" data-game="death-roll">
      <Seats state={state} seatId={seatId} />
      <Bots table={table} state={state} />

      <div className="dr__stage">
        {/* Hidden from assistive tech only between games: once one is running
            or has just ended, this number is the one fact worth announcing. */}
        <div aria-hidden={state.phase === "waiting"} className={state.phase === "waiting" ? "dr__number--dim" : ""}>
          <Falling value={shown} rolling={intent.rolling} />
        </div>

        <Standing state={state} seatId={seatId} countdown={countdown} />

        {chance === null ? null : (
          <p className="dr__odds">
            {state.toRoll === seatId ? "You go" : `${nameOf(state, state.toRoll as string)} goes`}{" "}
            out this round: {(chance * 100).toFixed(1)}%
          </p>
        )}

        {/*
          Not shown once a game is over: the felt already says who takes it,
          and a second line repeating the same figure is a place for a stray
          number to disagree with the sentence beside it. `pending` is added in
          rather than waited for, so a pass lands on the pot the moment it is
          pressed.
        */}
        {state.phase === "playing" && state.pot + intent.pending > 0 ? (
          <p className="dr__pot">
            Pot{" "}
            <span
              className={`dr__pot-figure${state.forFun ? "" : " dr__pot-figure--chip"}${
                justPaid ? " dr__pot-figure--paid" : ""
              }`}
            >
              {fmt(state.pot + intent.pending)}
            </span>{" "}
            · round {state.round} of {state.rounds}
          </p>
        ) : null}
      </div>

      {/* Roll and ready share one slot — dr__controls — so the thumb's place
          on a phone does not move between a game running and the gap before
          the next one. */}
      {state.phase === "waiting" && mine !== null ? (
        <div className="dr__controls">
          <button
            type="button"
            className="btn dr__roll"
            // A second press before the table has answered the first would
            // ask it something it was already asked — the same guard Roll
            // and Pass already keep on their own outstanding intents.
            disabled={table.busy || intent.readying !== null}
            onClick={() => intent.ready(!(intent.readying ?? mine.ready))}
          >
            {(intent.readying ?? mine.ready) ? "Not ready" : "I'm ready"}
          </button>
        </div>
      ) : null}

      {mine === null || !myTurn ? null : (
        <Controls state={state} intent={intent} passHidden={passHidden} />
      )}

      <History rolls={state.history} seatName={(id) => nameOf(state, id)} />
    </section>
  );
}

/**
 * Turns a change at the table into sound, the same way every other table's
 * follows a comparison rather than an event: an opponent's throw earns the
 * same rattle this seat's own got on the press, and a table that only ever
 * made a noise for you would be a table you were playing alone.
 */
function useTableSound(state: TableView, seatId: string | null): void {
  const previous = useRef<TableView | null>(null);

  // Fetching needs nothing from the browser; playing does. So the files are
  // pulled straight away and the context waits for a touch.
  useEffect(() => {
    void preload();
  }, []);

  useEffect(() => {
    const wake = () => unlock();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before === null) {
      return;
    }
    const rolled = state.lastRoll;
    if (rolled === null || rolled === before.lastRoll) {
      return;
    }
    // This seat's own throw was already sounded on the press; an opponent's
    // is heard from nothing at all, so it gets the throw as well as the land.
    if (rolled.seatId !== seatId) {
      play("shake");
    }
    // The closest sound in the building to a die coming up a 1: Greed's own
    // bust, short and low, which is exactly what this roll is for this seat.
    play(rolled.result === 1 ? "farkle" : "land");
  }, [state, seatId]);
}

/**
 * True for a moment right after `active` turns true, and false again on its
 * own. For a class that has to restart a CSS animation exactly once per press
 * rather than for as long as the thing it marks stays true.
 */
function usePaidFlourish(active: boolean, ms = 380): boolean {
  const [flourish, setFlourish] = useState(false);
  const was = useRef(active);

  useEffect(() => {
    const rose = active && !was.current;
    was.current = active;
    if (!rose) {
      return;
    }
    setFlourish(true);
    const id = window.setTimeout(() => setFlourish(false), ms);
    return () => window.clearTimeout(id);
  }, [active, ms]);

  return flourish;
}

/** Somebody's name from their seat id, for a roll history that only kept ids. */
function nameOf(state: TableView, seatId: string): string {
  return state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";
}

/**
 * What the table is doing, in one line.
 *
 * Every phase has exactly one thing worth saying at a glance — waiting on
 * players, a move to make, somebody just out between rounds, or a game
 * decided — and this is the sentence that says it. Nothing here enforces
 * anything: a table refusing a move refuses it in words of its own, this is
 * only what a player reads.
 */
function Standing({
  state,
  seatId,
  countdown,
}: {
  state: TableView;
  seatId: string | null;
  countdown: number | null;
}) {
  if (state.phase === "waiting") {
    // Out of the players still here, as the table counts it: a seat held
    // after Leave is not somebody the deal is waiting on.
    const here = state.seats.filter((seat) => seat.connected).length;
    return (
      <p className="dr__standing" role="status">
        {state.waitingFor === "players" ? (
          "Waiting for players."
        ) : countdown !== null ? (
          <>
            Dealing in{" "}
            {/* Keyed on the seconds so each tick remounts and plays its motion once. */}
            <span key={countdown} className="dr__countdown">
              {countdown}
            </span>
            s — {state.readyCount} of {here} ready.
          </>
        ) : (
          `${state.readyCount} of ${here} ready.`
        )}
      </p>
    );
  }

  if (state.phase === "over") {
    const winner = state.winnerIds.length === 0 ? null : nameOf(state, state.winnerIds[0] as string);
    return (
      <p className="dr__standing" role="status">
        {winner === null ? "" : `${winner} takes the pot.`}
      </p>
    );
  }

  // Between rounds: the round just ended on somebody, not on a move to make.
  if (state.toRoll === null) {
    return (
      <p className="dr__standing" role="status">
        {state.lastOut === null ? "" : `${nameOf(state, state.lastOut)} is out.`}
      </p>
    );
  }

  return (
    <p className="dr__standing" role="status">
      {moveLine(state, seatId)}
    </p>
  );
}

/** Roll, or pass the roll on at a price. Only ever shown on your turn. */
function Controls({
  state,
  intent,
  passHidden,
}: {
  state: TableView;
  intent: Intent;
  passHidden: boolean;
}) {
  // Busy the moment either press lands, not only while the socket itself is —
  // a second click before the table has caught up would ask it something it
  // has already been asked.
  const busy = intent.rolling || intent.pending > 0;
  return (
    <div className="dr__controls">
      <button
        type="button"
        className="btn dr__roll"
        disabled={busy}
        onClick={() => {
          // The rattle of the throw, the instant it leaves this seat's hand —
          // sounded here rather than waited for, the same as the tumble itself.
          play("shake");
          intent.roll();
        }}
      >
        Roll
      </button>
      {/*
        Hidden once spent, or once the roll in hand arrived by a pass, rather
        than shown disabled. Hiding it is a courtesy — the server refuses
        either kind of second pass regardless — and a button nobody may ever
        press again is not information worth a slot on the felt.
      */}
      {passHidden ? null : (
        <button
          type="button"
          className="btn btn--ghost dr__pass"
          aria-label={(() => {
            // Named, since a pass goes on round the table and cannot come back.
            const to = passesTo(state);
            return to === null
              ? `Pass the roll on for ${fmt(state.passPrice)}`
              : `Pass the roll to ${nameOf(state, to)} for ${fmt(state.passPrice)}`;
          })()}
          disabled={busy}
          onClick={() => {
            play("bet");
            intent.pass();
          }}
        >
          <span className="dr__pass-name">Pass</span>
          <span className="dr__pass-price">{fmt(state.passPrice)}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Somebody to play, when there is nobody.
 *
 * A chips table needs real people and this one has no lobby to wait in, so a
 * for-fun table opened on your own would otherwise sit there for ever —
 * which is the whole reason bots exist in this building. Shown right under
 * the empty seats, because those are the seats it fills.
 *
 * Only at a table playing for nothing: chips are only won from real people,
 * and a bot has no account to take them from or pay them to. The table
 * refuses one either way — hiding the control is the courtesy, refusing the
 * message is the rule.
 */
function Bots({ table, state }: { table: Table; state: TableView }) {
  if (!state.forFun || state.seats.length >= state.maxSeats) {
    return null;
  }
  return (
    <div className="dr__bots">
      <span className="dr__bots-label">Deal somebody in</span>
      {(["easy", "normal", "hard"] as const).map((skill) => (
        <button
          key={skill}
          type="button"
          className="dr__bot"
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
 * Every seat at the table, in turn order, then anybody who sat down mid-game.
 *
 * Turn order rather than seating order, because with a pass that cannot be
 * handed back, where a pass would land is the thing a player has to read off
 * this list — and between games `order` is everybody seated, so the list
 * still means something before a game has dealt anybody in. A seat taken
 * while a game runs is in `seats` but not yet in `order`; it is drawn after
 * the dealt-in players rather than dropped, and rather than left to be drawn
 * over by an "Open seat" slot it is actually sitting in. Padded to the
 * table's full size with dashed open seats, since a table of six does not
 * draw the same as a table of two.
 */
function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  const dealt = state.order
    .map((id) => state.seats.find((seat) => seat.id === id))
    .filter((seat): seat is SeatView => seat !== undefined);
  const joined = state.seats.filter((seat) => !state.order.includes(seat.id));
  const seated = [...dealt, ...joined];
  const slots: (SeatView | null)[] = [...seated];
  while (slots.length < state.maxSeats) {
    slots.push(null);
  }

  return (
    <ul className="dr__seats">
      {slots.map((seat, at) =>
        seat === null ? (
          <li key={`empty-${at}`} className="dr__seat dr__seat--empty">
            <span className="dr__seat-name">Open seat</span>
          </li>
        ) : (
          <SeatRow key={seat.id} seat={seat} state={state} mine={seat.id === seatId} />
        ),
      )}
    </ul>
  );
}

/** One seat's whole story, read at a glance rather than worked out from the number. */
function SeatRow({
  seat,
  state,
  mine,
}: {
  seat: SeatView;
  state: TableView;
  mine: boolean;
}) {
  const isTurn = seat.id === state.toRoll;
  const forced = isTurn && state.passedTo === seat.id;
  // Marks the one seat the felt just announced going out, for the one short
  // motion it gets — cleared the moment the next round's first roll lands,
  // same as `lastOut` itself.
  const justOut = seat.id === state.lastOut;

  return (
    <li
      className={[
        "dr__seat",
        isTurn ? "dr__seat--turn" : "",
        forced ? "dr__seat--forced" : "",
        seat.out ? "dr__seat--out" : "",
        seat.connected ? "" : "dr__seat--away",
        justOut ? "dr__seat--just-out" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
      <span className="dr__seat-name">
        {seat.name}
        {mine ? " (you)" : ""}
      </span>
      {/* Who is actually at the table, said on the seat rather than left to
          be guessed from how fast a side rolls. */}
      {seat.isBot ? <span className="dr__seat-bot">bot</span> : null}
      {state.phase === "waiting" ? (
        <span className="dr__seat-ready">{seat.ready ? "ready" : "not ready"}</span>
      ) : null}
      {state.phase === "playing" && seat.inGame && !seat.out ? (
        <span className="dr__seat-pass">{seat.passed ? "passed" : "pass"}</span>
      ) : null}
      {/* A seat taken mid-game: sitting there, but not dealt into this
          round, so it must not read as a player still in the hand. */}
      {state.phase === "playing" && seat.waiting ? (
        <span className="dr__seat-waiting">sitting out this game</span>
      ) : null}
      {seat.out ? <span className="dr__seat-out">out</span> : null}
      {isTurn ? (
        <span className="dr__seat-turn-marker">
          {forced ? "must roll" : mine ? "your roll" : "to roll"}
        </span>
      ) : null}
      {seat.short ? <span className="dr__seat-short">short of the ante</span> : null}
      {state.forFun && seat.purse !== null ? (
        <span className="dr__seat-purse">{fmt(seat.purse)} play money</span>
      ) : null}
    </li>
  );
}

/** Every roll of the round on the felt, oldest first, in its own scrolling strip. */
function History({
  rolls,
  seatName,
}: {
  rolls: TableView["history"];
  seatName: (id: string) => string;
}) {
  if (rolls.length === 0) {
    return null;
  }
  return (
    <ol className="dr__history" aria-label="Rolls this round, oldest first">
      {rolls.map((rolled, at) => (
        <li
          // The position is the identity: the same ceiling can come up twice
          // and what tells the two rolls apart is which one happened first.
          key={`${at}:${rolled.seatId}:${rolled.from}:${rolled.result}`}
          className="dr__past"
          title={`${seatName(rolled.seatId)} rolled ${rolled.result} out of ${rolled.from}`}
        >
          {rolled.result}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------- the lobby */

export function Sit({
  table,
  invited,
  account,
}: {
  table: Table;
  invited: string;
  account: Account;
}) {
  const [stake, setStake] = useState<number>(STAKES[1]);
  const [ceiling, setCeiling] = useState<number>(CEILINGS[1]);

  return (
    <TableSetup
      game="death-roll"
      pitch="Two to six players and a number that only goes down. Roll under the ceiling or pay a tenth of the ante to hand the roll back — roll a one and you are out, and the last one left takes the pot."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{ fun: "Play money, and the table is yours to shape. Anybody can sit down." }}
      // Up to six, and fixed once the table is open, the same as the ante and
      // the opening ceiling.
      seats={{ initial: DEATH_ROLL.maxSeats, ceiling: DEATH_ROLL.maxSeats }}
      options={
        /*
         * What a game here costs, and where it starts. Both are decisions
         * about the whole evening rather than one player's, the same way a
         * betting window belongs to whoever opens a roulette table — so they
         * are picked here, once, by the host.
         */
        <>
          <div className="dr__pickrow" role="radiogroup" aria-label="What a game costs">
            <span className="dr__pickrow-label">Ante</span>
            <div className="dr__pick-options">
              {STAKES.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={stake === level}
                  className={`dr__pick${stake === level ? " dr__pick--on" : ""}`}
                  onClick={() => setStake(level)}
                >
                  {fmt(level)}
                </button>
              ))}
            </div>
          </div>

          <div className="dr__pickrow" role="radiogroup" aria-label="Where the first round starts">
            <span className="dr__pickrow-label">Opens at</span>
            <div className="dr__pick-options">
              {CEILINGS.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={ceiling === level}
                  className={`dr__pick${ceiling === level ? " dr__pick--on" : ""}`}
                  onClick={() => setCeiling(level)}
                >
                  {fmt(level)}
                </button>
              ))}
            </div>
          </div>
        </>
      }
      note={({ forFun }) =>
        `You get a five-character code to share. One ante each${forFun ? ", and play money that lives at the table." : "."}`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "death-roll", forFun, buyIn: stake, ceiling, maxSeats })
      }
    />
  );
}

export default DeathRoll;
