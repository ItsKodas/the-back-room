import type { TableView } from "@backroom/game-blackjack";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { play } from "../game/audio.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useCountdown } from "../game/useCountdown.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { ActivityLog, useActivity } from "../table/Activity.js";
import { Refusal } from "../table/Refusal.js";
import { Sheet } from "../table/Sheet.js";
import { TableSetup } from "../table/TableSetup.js";
import { TalkKey, TalkSheet, useTalk } from "../table/TalkSheet.js";
import { useTableKeys } from "../table/useTableKeys.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import { Controls } from "./Controls.js";
import { HowItPays, PAYS_SHEET_ID, paysFor } from "./HowItPays.js";
import { DiscordIcon, TableIcon } from "./Icons.js";
import { Moments } from "./Moments.js";
import { Readout, readoutFor } from "./Readout.js";
import { Dealer, Seats } from "./Seats.js";
import { TABLE_SHEET_ID, TableSheet } from "./TableSheet.js";
import { useCardSound } from "./useCardSound.js";
import type { Move } from "./useIntent.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-blackjack/theme.css";
import "./blackjack.css";

type Table = TableSocketHook<TableView>;

// Module-level so the object identity is stable across renders — useTableKeys
// re-binds its listeners whenever this reference changes.
const KEYS = { " ": "Space", s: "S", d: "D", p: "P" } as const;

export function Blackjack() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/blackjack"), [navigate]);
  // The balance in the corner follows the hand: the stake goes as the chips
  // are pushed out and the payout lands on the table's own clock, neither of
  // which the browser asked for.
  const table = useTableSocket<TableView>("blackjack", back, account.setChips);
  const { state, seatId } = table;
  useCardSound(state, seatId);

  useNav({
    room: "blackjack",
    game: "Blackjack",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            confirm: state.phase === "playing",
          },
        }
      : {}),
    connected: table.connected,
  });

  // The address bar follows the table, so the link can be shared and a refresh
  // lands back at the same one.
  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/blackjack/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  // The felt, as against setup and sign-in, which are pages and scroll like them.
  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit" : ""}`}>
      {/* At the table a refusal takes the middle of the board; on a page it stays a strip. */}
      {atTable ? (
        <Refusal message={table.error} id={table.errorKey} />
      ) : table.error !== null ? (
        <p className="play__error">{table.error}</p>
      ) : null}

      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        <>
          <BlackjackTable table={table} state={state} seatId={seatId} account={account} />
          {/* Over the felt, because a taunt belongs to the table and not to the cards. */}
          <TauntStage landed={table.landed} />
        </>
      )}
    </main>
  );
}

function BlackjackTable({
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
  const chips = account.profile?.chips ?? null;
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  /*
   * What this player has asked for, before the table has answered.
   *
   * A move is a round trip, and a round trip is long enough for a button to
   * feel broken. So a press changes the felt at once and the table's answer
   * replaces it — never inventing anything, only showing what was asked for.
   */
  const intent = useIntent(state, seatId, table.error, table.errorKey);
  // A stake is this player's own number, so it shows from the press.
  const mine = intent.bet ?? me?.bet ?? 0;
  const left = useCountdown(state.deadline);
  const turnLeft = useCountdown(state.turnEndsAt);
  const talk = useTalk(table.chat, seatId);
  // Kept from the first line the table says, so nothing is lost while talk is
  // shut; the counter tells "Ada is ready" twice from one broadcast sent twice.
  const activity = useActivity({ code: state.code, text: state.lastEvent, seq: state.eventSeq });
  const [sheet, setSheet] = useState<"pays" | "table" | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Talk and a sheet are two dialogs claiming the same rectangle at desk width, so
  // opening one has to close the other rather than stacking a second scrim on top.
  const toggleSheet = (which: "pays" | "table") => {
    talk.close();
    setSheet((was) => (was === which ? null : which));
  };
  const toggleTalk = () => {
    setSheet(null);
    talk.toggle();
  };
  const root = useRef<HTMLElement | null>(null);
  // Stacking chips and then pressing Space is the rhythm this table is played at.
  useTableKeys(root, KEYS, { handsOverSpace: ".bj__chip" });
  const isHost = state.hostId === seatId && seatId !== null;
  const pays = paysFor(state, seatId, chips);

  /**
   * Sends a move, and shows it as sent. Both in one place so the two can never
   * disagree — a move that reached the table without the felt knowing would
   * leave the buttons live for a second move on the same cards.
   */
  const move = (kind: Move) => {
    intent.send(kind);
    table.act({ type: kind });
  };
  const stake = (amount: number) => {
    // Sounded and shown on the press: the whole point of a chip is that it lands under your finger.
    play("bet");
    intent.place(amount);
    table.act({ type: "bet", amount });
  };
  const ready = (value: boolean) => {
    intent.setReady(value);
    table.act({ type: "ready", ready: value });
  };
  // This player's own last press until the table agrees, so "Waiting…" shows
  // on the tap rather than after a round trip.
  const readyShown = intent.ready ?? me?.ready ?? false;
  const log = <ActivityLog entries={activity} />;

  return (
    <section className="bj" aria-label="The table" ref={root}>
      <div className="bj__in">
        <Readout model={readoutFor({ state, seatId, mine, chips, move: intent.move, left, turnLeft })} />

        <div className="bj__felt">
          <div className="bj__cloth table-scroll">
            <Dealer dealer={state.dealer} watching={state.watching} />
            <div className="bj__arc" aria-hidden="true" />
            <Seats
              state={state}
              seatId={seatId}
              stake={mine}
              arriving={intent.move === "hit" || intent.move === "double"}
            />
          </div>
          <div className="table-talk-corner">
            <TalkKey open={talk.open} unread={talk.unread} onToggle={toggleTalk} />
          </div>
          <div className="bj__corner">
            <button
              type="button"
              className="key key--icon bj__help"
              aria-label="How it pays"
              aria-controls={PAYS_SHEET_ID}
              aria-expanded={sheet === "pays"}
              onClick={() => toggleSheet("pays")}
            >
              ?
            </button>
            {isHost ? (
              <button
                type="button"
                className="key key--icon bj__host"
                aria-label="Table"
                aria-controls={TABLE_SHEET_ID}
                aria-expanded={sheet === "table"}
                onClick={() => toggleSheet("table")}
              >
                <TableIcon />
              </button>
            ) : null}
          </div>
          <Moments me={me} />
          <Sheet
            id={PAYS_SHEET_ID}
            label="How it pays"
            open={sheet === "pays"}
            onClose={closeSheet}
            className="sheet--felt"
          >
            <HowItPays pays={pays} />
          </Sheet>
        </div>

        <aside className="bj__rules" aria-label="How it pays">
          <h2 className="bj__panel-title">How it pays</h2>
          <HowItPays pays={pays} />
        </aside>

        <aside className="bj__activity" aria-label="Activity">
          <h2 className="bj__panel-title">Activity</h2>
          {log}
        </aside>

        <Controls
          state={state}
          me={me}
          mine={mine}
          ready={readyShown}
          chips={chips}
          move={intent.move}
          left={left}
          turnLeft={turnLeft}
          isHost={isHost}
          taunt={
            <TauntPicker
              seats={state.seats}
              seatId={seatId}
              chips={chips}
              stakes={table.stakes}
              openClassName="key"
              onThrow={(emote, at) => {
                // The cost leaves the corner on the press: it is the player's
                // own number, so showing it at once invents nothing.
                if (account.profile !== null) {
                  account.setChips(account.profile.chips - emote.cost);
                }
                table.taunt(emote.id, at, (result) => {
                  if (result.ok) {
                    account.setChips(result.chips);
                  } else {
                    // Refused, so give the early decrement back.
                    account.refresh();
                  }
                });
              }}
            />
          }
          onStake={stake}
          onReady={ready}
          onDeal={() => table.act({ type: "deal" })}
          onMove={move}
        />
      </div>

      {isHost ? (
        <TableSheet
          open={sheet === "table"}
          onClose={closeSheet}
          code={state.code}
          bettingMs={state.bettingMs}
          listed={table.listed}
          forFun={state.forFun}
          seated={state.seats.length}
          maxSeats={state.maxSeats}
          onWindow={(ms) => table.act({ type: "window", ms })}
          onListed={table.setListed}
          onBot={table.addBot}
        />
      ) : null}
      <TalkSheet
        open={talk.open}
        onClose={talk.close}
        log={table.chat}
        seatId={seatId}
        onSay={table.say}
        activity={log}
      />
    </section>
  );
}

/**
 * A table you have to be somebody to sit at.
 *
 * Reached by following a link to a table that plays for chips without an
 * account. The link is not broken and this is not a refusal — it is the one
 * step between them and the seat, with the seat still named so they can see
 * they are in the right place.
 */
function SignInToJoin({ code, onWatch }: { code: string; onWatch: () => void }) {
  // Back to this table once Discord is done, rather than the front door: the
  // whole point of following a link is arriving where it pointed.
  const back = `/auth/discord?to=${encodeURIComponent(`/blackjack/${code}`)}`;

  return (
    <div className="join join--gate">
      <section className="housing gate" aria-labelledby="gate-title">
        <div className="housing__head">
          <p className="label">Table {code}</p>
        </div>
        <div className="housing__body">
          <h2 className="gate__title" id="gate-title">
            This one plays for chips
          </h2>
          <p className="gate__note">
            Chips come from an account, so there is one step before you sit down. Sign in and you
            will land back at this table.
          </p>
          <a className="slab slab--wide slab--discord" href={back}>
            <DiscordIcon />
            <span>Sign in with Discord</span>
          </a>
          <button type="button" className="key key--wide" onClick={onWatch}>
            Just watch this one
          </button>
          <p className="panel__note">
            Or <Link to="/blackjack">open a table of your own</Link> — a for-fun one deals play
            money and anybody can sit down.
          </p>
        </div>
      </section>
    </div>
  );
}

function Sit({
  table,
  invited,
  account,
}: {
  table: Table;
  invited: string;
  account: Account;
}) {
  /*
   * What the link they followed actually leads to.
   *
   * Asked before they touch anything, because a table playing for chips needs
   * an account and the useful thing to say then is "sign in", not a form for
   * opening a table of your own.
   */
  const peek = useTablePeek(invited);
  const waiting = peek.table;
  if (waiting !== null && !waiting.forFun && account.profile === null && !account.loading) {
    return <SignInToJoin code={waiting.code} onWatch={() => table.watch(waiting.code)} />;
  }

  return (
    <TableSetup
      game="blackjack"
      pitch="Beat the dealer to twenty-one without going past it. Blackjack pays three to two, the dealer stands on seventeen."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{
        fun: "Play money that lives at the table. Anybody can sit down.",
        guestWarning:
          "Playing for fun deals you five thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
      }}
      note={() =>
        "You get a five-character code to share. Everybody plays the dealer rather than each other."
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "blackjack", forFun, maxSeats })
      }
    />
  );
}
