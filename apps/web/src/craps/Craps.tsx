import type { TableView } from "@backroom/game-craps";
import {
  CHIPS,
  HORN_STEP,
  MIN_CHIP,
  ROLL_MS,
  SPOTS,
  WINDOWS,
  after,
  headroom,
  multiplier,
  ratioOf,
  spotAt,
  toBets,
  total,
} from "@backroom/game-craps";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { Controls } from "./Controls.js";
import { Dice } from "./Dice.js";
import { BOXES, boxFor, oddsSpotFor } from "./layout.js";
import { Rail } from "./Rail.js";
import { useGhostChips } from "./useGhostChips.js";
import { useThrowSound } from "./useThrowSound.js";
import "@backroom/game-craps/theme.css";
import "./craps.css";

/**
 * The craps table, wired up.
 *
 * The same plumbing as `Roulette.tsx` — one socket hook, one taken-window
 * panel, one lobby — because none of that changes from one banked table to the
 * next. What is different is the hand: a wheel sweeps its cloth every spin and
 * this one does not, so the felt has to say what is still riding, what is
 * asleep through a come-out, and what the bank could not carry this roll.
 *
 * And the chips go down on the press. A stake is a number the player chose, so
 * there is nothing to invent; the dice are not, so nothing here guesses them.
 * See `useGhostChips.ts`, which is the whole of that bargain.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

export function Craps() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/craps"), [navigate]);
  const table = useTableSocket<TableView>("craps", back, account.setChips);
  const { state, seatId } = table;

  useNav({
    room: "craps",
    game: "Craps",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            /*
             * Asked twice while the window is open, because chips on the
             * cloth are already in the bank and standing up gives up whatever
             * the bank cannot hand back. Not asked once the dice are out:
             * what is riding then rides whatever the seat does, and is paid to
             * the account either way.
             */
            confirm: state.phase === "betting" && (state.you?.staked ?? 0) > 0,
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/craps/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    // Wider only at the cloth: the screen before it is the building's width.
    <main className={state === null ? "play" : "play play--pit"}>
      {table.error !== null ? <p className="play__error">{table.error}</p> : null}

      {/*
        A second window on the same game is turned away, and says so in its own
        panel rather than as a disconnection — one table per player, because
        two of them would be one person betting against their own bank.
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
  /** Whether a press on the cloth lays odds behind rather than a bet on. */
  const [odds, setOdds] = useState(false);

  useThrowSound(state.phase, state.dice);

  /*
   * Chips on the cloth before the server has heard of them. Every move here is
   * a round trip, and a stake is the one thing at this table the player
   * already knows — so it goes down on the press and is given up on if the
   * table refuses it or never answers.
   */
  const { cloth, press, refused: giveUpSpot, clear: giveUp } = useGhostChips(state.placed, seatId);

  /*
   * A refusal arrives as `room:error` rather than as a reply to any one press
   * — `game:action`'s ack carries nothing — so this is the one place every
   * guess on this felt gives up at once, whichever of them the table was
   * actually refusing. The server's own `placed` puts back whatever did land.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (table.error !== null) {
      giveUp();
    }
  }, [table.error, table.errorKey, giveUp]);

  // The window has shut. Anything not acknowledged by now did not get down.
  useEffect(() => {
    if (state.phase !== "betting") {
      giveUp();
    }
  }, [state.phase, giveUp]);

  /*
   * The boxes this roll paid, once the dice are at rest.
   *
   * A fact about the dice and the hand they were thrown on, read off the
   * rulebook rather than off anybody's chips: `settle` has already swept what
   * ended away by the time this is drawn, so there is no winning bet left to
   * point at. Whether one seat's number happened to be asleep through it is a
   * fact about that seat, and its own Off lozenge says so.
   *
   * Null until the dice have stopped. The view carries them all through the
   * throw so the felt can settle them onto the real faces, and lighting the
   * boxes from that would give the result away several seconds early.
   */
  const landedOn = useMemo(() => {
    const dice = state.dice;
    if (dice === null || state.phase !== "settling") {
      return null;
    }
    const hand = { point: state.history[state.history.length - 1]?.point ?? null };
    const boxes = new Set<string>();
    for (const spot of SPOTS.values()) {
      const paid = ratioOf(multiplier(spot, dice, hand));
      /*
       * A bet that stays up is handed its winnings alone, so anything at all
       * is a win; one that ends is handed its stake with them, so one chip per
       * chip is a push. The big six is the case that makes the difference:
       * it pays even money and stays, so it wins at exactly one.
       */
      const won = after(spot, dice, hand) === null ? paid > 1 : paid > 0;
      const box = won ? boxFor(spot.id) : null;
      if (box !== null) {
        boxes.add(box);
      }
    }
    return [...boxes];
  }, [state.dice, state.phase, state.history]);

  /*
   * What each spot can still take, worked out here exactly as the server works
   * it out. Shown, never enforced — the table refuses the message either way.
   * Without it a player learns the cap by being refused, which is a worse way
   * to find out.
   *
   * Against the server's own cloth rather than the one with guesses on it: a
   * cap is the bank's arithmetic, and feeding it chips the bank has not
   * acknowledged would be the browser vouching for itself.
   */
  const bets = useMemo(() => toBets(state.placed), [state.placed]);
  const hand = useMemo(() => ({ point: state.point }), [state.point]);
  const room = useCallback(
    (spotId: string) => {
      const spot = spotAt(spotId);
      return spot === null ? 0 : headroom(state.bank, bets, hand, spot);
    },
    [state.bank, bets, hand],
  );

  /** Which bet a press on this box would actually place, if any. */
  const pressWould = useCallback(
    (boxId: string): string | null =>
      odds ? oddsSpotFor(boxId, cloth, seatId, state.point) : boxId,
    [odds, cloth, seatId, state.point],
  );

  /*
   * The boxes the bank has no room left on, greyed so nobody has to find the
   * cap by being refused. With odds being laid, only the boxes that could take
   * odds at all are asked — the rest are not full, they have nothing behind
   * them, and the odds outline already says which those are.
   */
  const full = useMemo(
    () =>
      BOXES.filter((boxId) => {
        const spotId = pressWould(boxId);
        return spotId !== null && room(spotId) < MIN_CHIP;
      }),
    [pressWould, room],
  );

  const mine = state.you;
  const canBet = state.phase === "betting" && !state.lastCall && mine !== null;

  /*
   * Why the last press did nothing.
   *
   * The cap is the server's and it refuses in words, but the felt does not
   * send a chip it already knows is too big — which would leave a press that
   * did nothing at all and said nothing either. An empty bank looked exactly
   * like a broken table: every chip silently ignored, everything else normal.
   */
  const [refused, setRefused] = useState<string | null>(null);

  const place = (boxId: string) => {
    if (!canBet) {
      return;
    }
    const spotId = pressWould(boxId);
    if (spotId === null) {
      setRefused("There is nothing to back with odds there yet.");
      return;
    }
    // The horn's price has a four in the denominator, so it takes sixties. The
    // table says the same thing; a felt that sent the chip anyway would be
    // offering a press whose only outcome is a refusal.
    const step = spotId === "horn" ? HORN_STEP : MIN_CHIP;
    if (chip % step !== 0) {
      setRefused(`The ${spotAt(spotId)?.label.toLowerCase()} takes multiples of ${fmt(step)}.`);
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
    press(spotId, chip);
    table.act({ type: "place", spotId, chips: chip });
  };

  /** What this seat has on the cloth, its own un-landed guesses included. */
  const down = useMemo(
    () => cloth.filter((one) => one.seatId === seatId).reduce((sum, one) => sum + one.chips, 0),
    [cloth, seatId],
  );

  return (
    <section className="cr" data-game="craps">
      <Standing state={state} refused={refused} />

      <div className="cr__table">
        <div className="cr__pit">
          <Rail point={state.point} history={state.history} winners={state.winners} />
          {/*
            Kept open whether or not there are dice in it. There is nothing to
            draw between rolls — a die that has not been thrown is not a fact
            — but a table that closed the gap and reopened it would shunt the
            whole cloth down the page twice a hand, with somebody's thumb
            already on its way to a box.
          */}
          <div className="cr__throwing">
            <Dice dice={state.dice} thrown={state.phase === "rolling"} ms={ROLL_MS} />
          </div>
        </div>
        <Cloth
          placed={cloth}
          mine={seatId}
          point={state.point}
          offByBank={state.offByBank}
          odds={odds}
          landedOn={landedOn}
          full={full}
          disabled={!canBet}
          onPlace={place}
          onTake={(boxId) => {
            if (!canBet) {
              return;
            }
            const spotId = pressWould(boxId) ?? boxId;
            // Chips coming off make a guess about chips going on void.
            giveUpSpot(spotId);
            table.act({ type: "take", spotId, chips: chip });
          }}
        />
      </div>

      {mine === null ? (
        <p className="cr__watching">{state.watching} watching. Take a seat to play.</p>
      ) : (
        <Controls
          table={table}
          state={state}
          seatId={seatId}
          chip={chip}
          onChip={setChip}
          odds={odds}
          onOdds={setOdds}
          room={room}
          down={down}
          onGiveUp={giveUp}
        />
      )}

      <Seats state={state} seatId={seatId} />
    </section>
  );
}

/** The bets the bank could not carry this roll, as somebody would say them. */
function namesOf(spotIds: readonly string[]): string {
  const names = spotIds.map((one) => spotAt(one)?.label ?? one);
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What the table is doing, and how long it is doing it for.
 *
 * The one line everybody at the table reads, and at a craps table it carries
 * one thing roulette's does not: whether there is a point up and what it is.
 * Every bet on this cloth resolves differently depending on the answer, so it
 * is said in words as well as by the puck.
 */
function Standing({ state, refused }: { state: TableView; refused: string | null }) {
  const left = useCountdown(state.deadline);
  const point = state.point === null ? "Coming out" : `Point is ${state.point}`;

  const said = (): { text: string; mood: "" | "last" | "shut" } => {
    /*
     * A bank with nothing in it is said before anybody presses anything.
     *
     * This table pays from chips other players staked, and a new one has none
     * until an admin floats it — so "nothing can be bet here" is a fact about
     * the table, not a refusal of your press, and it belongs on screen while
     * you are still deciding rather than after you have tried.
     */
    if (state.phase === "betting" && state.bank <= 0) {
      return { text: "The bank is empty — nothing to play for yet.", mood: "last" };
    }
    if (state.phase === "betting" && refused !== null) {
      return { text: refused, mood: "last" };
    }
    if (state.phase === "sealed" || state.phase === "releasing") {
      return { text: "No more bets.", mood: "shut" };
    }
    if (state.phase === "rolling") {
      return { text: "The dice are out.", mood: "shut" };
    }
    if (state.phase === "settling") {
      return {
        // "Rolled", not the bare figure the wheel says: this line already
        // carries a number — the point — and two on their own read as one.
        text: `${state.dice === null ? "" : `Rolled ${total(state.dice)}. `}Paying out.`,
        mood: "",
      };
    }
    return {
      text: `${state.lastCall ? "Last call" : "Place your bets"}${left === null ? "" : ` — ${left}s`}`,
      mood: state.lastCall ? "last" : "",
    };
  };

  const now = said();
  return (
    <p className={`cr__standing${now.mood === "" ? "" : ` cr__standing--${now.mood}`}`} role="status">
      <span className="cr__standing-point">{point}.</span> {now.text}
      {/*
        Which bets the bank could not carry, in words rather than as a tint on
        a stack somebody has to already be looking at. Nothing was lost — an
        off bet neither wins nor loses — and saying so is the difference
        between a rule of the game and software that quietly ignored you.
      */}
      {state.offByBank.length > 0
        ? ` The bank could not carry ${namesOf(state.offByBank)} this roll, so those chips sat it out.`
        : ""}
    </p>
  );
}

/** Everybody at the table, and what the last roll did to them. */
function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ul className="cr__seats">
      {state.seats.map((seat) => {
        const paid = state.paid.find((one) => one.seatId === seat.id);
        const up = paid === undefined ? null : paid.back - paid.staked;
        return (
          <li
            key={seat.id}
            className={`cr__seat${seat.id === seatId ? " cr__seat--you" : ""}${
              seat.connected ? "" : " cr__seat--away"
            }`}
          >
            <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
            <span className="cr__seat-name">{seat.name}</span>
            {/* Whose dice they are. A word rather than a mark, because the
                shooter is the one thing at this table that moves round. */}
            {seat.shooter ? <span className="cr__seat-shooter">Shooter</span> : null}
            {seat.staked > 0 ? <span className="cr__seat-down">{fmt(seat.staked)}</span> : null}
            {up === null || state.phase !== "settling" ? null : (
              <span className={`cr__seat-up${up >= 0 ? "" : " cr__seat-up--down"}`}>
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
      game="craps"
      pitch="Two dice, a point to make, and a rail of people shouting. The table pays from a bank that players alone fill, so nothing is won here that somebody put in."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{ fun: "Play money, and you can deal bots in. Anybody can sit down." }}
      seats={{ ceiling: 8 }}
      options={
        /*
         * How long the felt takes bets for. A decision about everybody's
         * evening rather than one player's — fifteen seconds and a minute are
         * different games to stand at — so it belongs to the host, with the
         * rest of the table's shape.
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
                aria-label={`${level / 1000} seconds a roll`}
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
        `You get a five-character code to share. The dice come round on their own every ${window / 1000} seconds, and the shooter can send them early${
          forFun
            ? ", with play money that lives at the table."
            : ". Chips leave your balance as they land on the cloth."
        }`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "craps", forFun, maxSeats, window })
      }
    />
  );
}

export default Craps;
