import type { Kind, TableView } from "@backroom/game-roulette";
import { CHIPS, headroom, SPIN_MS, spotAt, toBets, WINDOWS } from "@backroom/game-roulette";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { play } from "../game/audio.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useCountdown } from "../game/useCountdown.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { ActivityLog, useActivity } from "../table/Activity.js";
import { Refusal } from "../table/Refusal.js";
import { TableSetup } from "../table/TableSetup.js";
import { TalkKey, TalkSheet, useTalk } from "../table/TalkSheet.js";
import { useTableKeys } from "../table/useTableKeys.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Seg } from "../fittings/Seg.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import { Cloth } from "./Cloth.js";
import { Controls } from "./Controls.js";
import { History } from "./History.js";
import { HowItPays, PAYS_SHEET_ID } from "./HowItPays.js";
import { ANCHORS } from "./layout.js";
import { Wheel } from "./Wheel.js";
import { Winners } from "./Winners.js";
import "@backroom/game-roulette/theme.css";
// What every table in the building shares, `play--fit` — the page that is
// exactly the window — included. Nothing else on this page pulls it in.
import "../table/table.css";
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

  // The felt is the window; setup and join are pages and scroll like them.
  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit play--roulette" : ""}`}>
      {/*
        At the table a refusal takes the middle of the board, because a strip
        above the felt is a strip nobody reads with a window closing on them.
        On a page — setup, or a table that turned you away — it stays a strip:
        there is nothing there to cover, and nothing being decided on a clock.
      */}
      {atTable ? (
        <Refusal message={table.error} id={table.errorKey} />
      ) : table.error !== null ? (
        <p className="play__error">{table.error}</p>
      ) : null}

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
          <Felt table={table} state={state} seatId={seatId} account={account} />
          {/* Over the felt, because a taunt belongs to the table and not to the cloth. */}
          <TauntStage landed={table.landed} />
        </>
      )}
    </main>
  );
}

/* -------------------------------------------------------------- the felt */

/*
 * The three keys that press the three acts, by the letters those buttons
 * already declare in their aria-keyshortcuts.
 *
 * A module constant rather than a literal in the call: useTableKeys holds this
 * in an effect's dependencies by identity, and an object written inline is a
 * new object every render — which would tear the listeners down and build them
 * again on every tick of the countdown.
 */
const SHORTCUTS = { r: "R", u: "U", c: "C" } as const;

export function Felt({
  table,
  state,
  seatId,
  account,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
  account: Account;
}) {
  const [chip, setChip] = useState<number>(CHIPS[CHIPS.length - 1]);

  /* Behind the ? key: what the cloth is worth, lighting whatever it is aimed at. */
  const [paysOpen, setPaysOpen] = useState(false);
  const [aimedKind, setAimedKind] = useState<Kind | null>(null);

  const talk = useTalk(table.chat, seatId);
  /*
   * Everything the table has said, kept from its first line.
   *
   * The server only ever sends the latest one, so a table that said "Bram sat
   * down" while talk was shut said it to nobody. The counter is what tells one
   * broadcast sent twice from the same sentence happening twice — the same
   * player winning the same amount on the same number is an ordinary evening.
   */
  const activity = useActivity({ code: state.code, text: state.lastEvent, seq: state.eventSeq });

  /*
   * Talk and what it pays are two dialogs claiming one rectangle, so opening
   * either shuts the other rather than stacking a second scrim over the first.
   */
  const closePays = useCallback(() => setPaysOpen(false), []);
  const togglePays = () => {
    talk.close();
    setPaysOpen((was) => !was);
  };
  const toggleTalk = () => {
    setPaysOpen(false);
    talk.toggle();
  };

  /*
   * The table, switched off under whichever sheet is standing on it.
   *
   * A scrim stops a pointer and nothing else, and the cloth keeps a reachable
   * button for all 157 bets — parked off-screen until the keyboard's ring
   * finds one, and painted under the sheet rather than over it. Shift+Tab out
   * of an open panel therefore landed on a live money button nobody could see,
   * with Enter putting a chip down on it. `inert` is the narrow answer: a
   * focus trap would have to be written into talk and would change five other
   * tables to fix one.
   *
   * Three places rather than the one it ought to be, because what it pays is
   * itself inside the stage: there is no single ancestor here holding all of
   * the table and neither of the sheets. Nothing else under them focuses.
   */
  const underSheet = paysOpen || talk.open;
  // React 18 has no `inert` prop of its own, and an empty string is the
  // attribute as HTML spells it.
  const shut = underSheet ? { inert: "" } : {};

  /*
   * The keys press the buttons on screen rather than calling what they call,
   * so a key can never do what the button would refuse. Bound to the felt, so
   * a letter typed into the talk box is a letter.
   */
  const root = useRef<HTMLElement | null>(null);
  useTableKeys(root, SHORTCUTS);

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

  /* While the ball is rolling, which is the one stretch of a round with
     nothing to do. On the right, so its panel opens on screen. */
  const taunt =
    state.phase === "spinning" ? (
      <TauntPicker
        seats={state.seats.map((seat) => ({
          id: seat.id,
          name: seat.name,
          isBot: seat.isBot,
          signedIn: seat.signedIn,
        }))}
        seatId={seatId}
        chips={account.profile?.chips ?? null}
        stakes={table.stakes}
        onThrow={(emote, at) => {
          /*
           * The cost is a number the player already chose — the emote and
           * its price are picked before this fires — so it leaves the
           * corner on the press rather than waiting on a spin's round trip.
           * A wheel is exactly the moment CLAUDE.md means by a bad
           * connection: the ball is already in the air, and a figure that
           * only catches up once the table answers reads as a press that
           * did nothing.
           */
          if (account.profile !== null) {
            account.setChips(account.profile.chips - emote.cost);
          }
          table.taunt(emote.id, at, (result) => {
            if (result.ok) {
              account.setChips(result.chips);
            } else {
              // Refused, so the guess the press made is given back.
              account.refresh();
            }
          });
        }}
        openClassName="key"
      />
    ) : null;

  /*
   * The best the bank can do anywhere on the cloth, which is what the custom
   * box's range is quoted against. Shown, never enforced — the server checks
   * the actual spot again on the way in, and that is the only number that can
   * refuse anything.
   */
  const reach = useMemo(
    () => ({
      most: ANCHORS.reduce((best, one) => Math.max(best, room(one.spotId)), 0),
      purse: mine?.purse ?? null,
      bank: state.bank,
    }),
    [room, mine, state.bank],
  );

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
    play("bet");
    table.act({ type: "place", spotId, chips: chip });
  };

  /*
   * Which of the two has the stage.
   *
   * A phone has not the height for both a wheel and a cloth whose squares you
   * can hit, so whichever of them matters now takes the room: the cloth is
   * shut while the ball is rolling, and the wheel is decoration while it is
   * not. It comes back to the cloth at "settled" rather than at the next
   * window — settling is when the cloth is worth looking at, with the winning
   * square lit and the payouts landing on the seats. A desk has the room for
   * both and swaps nothing; see the stylesheet.
   */
  const onStage = turning ? "wheel" : "cloth";

  return (
    <section className="rl" data-game="roulette" ref={root}>
      {/*
        The rest of the table, while what it pays is open: a tap off the sheet
        shuts it, the way a tap off talk shuts talk. Out here rather than inside
        the sheet, which covers its own stage entirely — everywhere you could
        tap "outside" it is out here — and before the table rather than after
        it, which is what leaves the stage drawn over the top. See the
        stylesheet: the stage is a stacking context and the sheet cannot climb
        out of it.
      */}
      {paysOpen ? (
        <button
          type="button"
          className="rl__pays-scrim"
          tabIndex={-1}
          aria-label="Close what it pays"
          onClick={closePays}
        />
      ) : null}

      <div className="rl__in" data-on={onStage}>
        <Standing state={state} />

        {/*
          The one record a roulette player actually reads, and it stays on the
          felt rather than going into the log with the table's sentences: a
          board you have to open something to see is a board nobody glances at.
          Twelve numbers wide, which is a strip rather than a row.
        */}
        <History pockets={state.history} />

        <div className="rl__stage">
          {/* The column the talk and ? keys stand in, beside the cloth. */}
          <div className="rl__corner" {...shut}>
            <TalkKey open={talk.open} unread={talk.unread} onToggle={toggleTalk} />
            <button
              type="button"
              className="key key--icon"
              aria-label="What it pays"
              aria-expanded={paysOpen}
              aria-controls={PAYS_SHEET_ID}
              onClick={togglePays}
            >
              ?
            </button>
          </div>
          <div className="rl__cloth-holds" {...shut}>
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
              onAim={setAimedKind}
            />
          </div>
          <HowItPays open={paysOpen} onClose={closePays} lit={aimedKind} />
        </div>

        {/*
          The wheel and the two boards: what the wheel is doing, what it has
          been doing, and what that has been worth to the people sitting at it.

          One element around all three, and it is invisible on a phone — see
          `.rl__side` in the stylesheet. A desk stands them in a column down
          the side; a phone deals the wheel out among the rows above, because
          it has to be able to take the stage on its own. Two wheels would be
          two answers to where the ball is.
        */}
        <div className="rl__side">
          <div className="rl__wheel-holds">
            <Wheel pocket={state.pocket} spinning={turning} spinMs={SPIN_MS} covered={covered} />
            {/*
              What the medallion says instead of drawing 37 pockets nobody can
              read at that size. Never the result while the ball is in the air:
              the view carries the pocket all through the spin so the wheel can
              roll to it, and a caption that named it would give the answer
              away several seconds early.
            */}
            <span className="rl__covered">
              {landed === null ? `${covered.size} of 37 covered` : `${landed}`}
            </span>
          </div>

          {/*
            The winners' board, which a desk has the height for and a phone has
            not. On a phone it goes where the table's other sentences are — the
            activity tab below — rather than off the table altogether.
          */}
          <div className="rl__boards">
            <Winners winners={state.winners} />
          </div>
        </div>

        {mine === null ? (
          <p className="rl__watching">{state.watching} watching. Take a seat to play.</p>
        ) : (
          <Controls
            chip={chip}
            onChip={setChip}
            reach={reach}
            refused={refused}
            open={canBet}
            betting={state.phase === "betting"}
            down={mine.staked}
            canRepeat={state.canRepeat}
            busy={table.busy}
            onRepeat={() => table.act({ type: "repeat" })}
            onUndo={() => table.act({ type: "undo" })}
            onClear={() => table.act({ type: "clear" })}
            taunt={taunt}
            shut={underSheet}
          />
        )}

        <Seats state={state} seatId={seatId} />
      </div>

      {/*
        Talk, opened on purpose rather than standing on the page taking height
        off the cloth. No region around it: the chat inside is already one named
        "Table talk", and two landmarks of a name is noise to a screen reader.
      */}
      <TalkSheet
        open={talk.open}
        onClose={talk.close}
        log={table.chat}
        seatId={seatId}
        onSay={table.say}
        activity={
          <>
            <Winners winners={state.winners} />
            <ActivityLog entries={activity} />
          </>
        }
      />
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
function Standing({ state }: { state: TableView }) {
  const left = useCountdown(state.deadline);

  /*
   * A watcher never opens Controls — said() lives there, and there is
   * nothing under them to render it — so this is the only place left that
   * can tell them the bank has nothing in it before their next press, which
   * is sitting down. A seated player gets the same fact from said(), with
   * its own precedence over a refusal; this branch stays out of their way.
   */
  if (state.you === null && state.phase === "betting" && state.bank <= 0) {
    return (
      <p className="rl__standing rl__standing--last" role="status">
        The bank is empty — nothing to play for yet.
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

export function Sit({
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
        <Seg
          label="Betting"
          value={String(window)}
          onChange={(value) => setWindow(Number(value))}
          options={WINDOWS.map((level) => ({ value: String(level), text: `${level / 1000}s` }))}
        />
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
