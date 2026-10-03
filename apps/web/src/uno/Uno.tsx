import type { Card, Color, Rules, TableView } from "@backroom/game-uno";
import { ANTE, officialRules, presetOf, STAKES } from "@backroom/game-uno";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DiscordIcon } from "../blackjack/Icons.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { ActivityLog, useActivity } from "../table/Activity.js";
import { Refusal } from "../table/Refusal.js";
import { Sheet } from "../table/Sheet.js";
import { TableSetup } from "../table/TableSetup.js";
import { TalkKey, TalkSheet, useTalk } from "../table/TalkSheet.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import {
  Centre,
  ColourPicker,
  Controls,
  Hand,
  Moment,
  needsOf,
  PeekCard,
  RoundOver,
  Seats,
  stillNeeds,
  TargetPicker,
  usePeekSeen,
  useUnoKeys,
} from "./Felt.js";
import { RulesForm, RulesSummary } from "./RulesForm.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-uno/theme.css";
import "./uno.css";

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");
const RULES_SHEET_ID = "uno-rules";

/**
 * Uno, wired up.
 *
 * The page is Liar's Dice's: a door to sit down at, then a felt. What is its
 * own is the felt — a rail of seats with their card counts, the two piles, and
 * your hand under your thumb — and the rules a host sets before anybody sits.
 */
export function Uno() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode = raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/uno"), [navigate]);
  const table = useTableSocket<TableView>("uno", back, account.setChips);
  const { state } = table;

  useNav({
    room: "uno",
    game: "Uno",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            // Asked mid-game, because the ante is already in the pot.
            confirm: state.phase === "playing" || state.phase === "between",
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/uno/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit play--uno" : ""}`} data-game="uno">
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
          <Felt table={table} state={state} seatId={table.seatId} account={account} />
          <TauntStage landed={table.landed} />
        </>
      )}
    </main>
  );
}

/** A card on its way into the pile, waiting on a colour or a target. */
interface Choosing {
  card: Card;
  jump: boolean;
  color?: Color;
  target?: string;
}

function Felt({
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
  const intent = useIntent(state, table.error, table.errorKey);
  const talk = useTalk(table.chat, seatId);
  const activity = useActivity({ code: state.code, text: state.lastEvent, seq: state.eventSeq });
  const [sheet, setSheet] = useState(false);
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const [peekOpen, closePeek] = usePeekSeen(state);
  const hand = state.hand;

  // The turn moving on throws away a half-chosen card: it may not be playable any more.
  const turnKey = `${state.toAct}:${state.step}:${state.top?.id ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the turn changing, which is the point
  useEffect(() => {
    setChoosing(null);
  }, [turnKey]);

  const send = (card: Card, chosen: { color?: Color; target?: string }) => {
    setChoosing(null);
    intent.play(card, chosen.color ?? null);
    table.act({
      type: "play",
      cardId: card.id,
      ...(chosen.color === undefined ? {} : { color: chosen.color }),
      ...(chosen.target === undefined ? {} : { target: chosen.target }),
    });
  };

  const pick = (card: Card, jump: boolean) => {
    const needs = needsOf(state, card);
    if (stillNeeds(needs, {}) === null) {
      send(card, {});
      return;
    }
    setChoosing({ card, jump });
  };

  const choose = (more: { color?: Color; target?: string }) => {
    if (choosing === null) return;
    const next = { ...choosing, ...more };
    if (stillNeeds(needsOf(state, next.card), next) === null) {
      send(next.card, next);
    } else {
      setChoosing(next);
    }
  };

  const draw = () => {
    if (hand?.canDraw !== true || intent.busy) return;
    intent.draw(hand.cards.length);
    table.act({ type: "draw" });
  };
  const pass = () => {
    if (hand?.canPass !== true || intent.busy) return;
    intent.press("pass");
    table.act({ type: "pass" });
  };
  const uno = () => {
    if (hand?.canUno !== true || intent.pressed === "uno") return;
    intent.press("uno");
    table.act({ type: "uno" });
  };
  useUnoKeys({ draw, pass, uno });

  const toggleSheet = () => {
    talk.close();
    setSheet((was) => !was);
  };
  const toggleTalk = () => {
    setSheet(false);
    talk.toggle();
  };

  const help = (
    <button
      type="button"
      className="key key--icon uno__help"
      aria-label="How it plays"
      aria-controls={RULES_SHEET_ID}
      aria-expanded={sheet}
      onClick={toggleSheet}
    >
      ?
    </button>
  );
  // Only the host, only for fun: a bot has no account to win chips from.
  const canAddBot = state.hostId === seatId && state.forFun && state.seats.length < state.maxSeats && state.phase === "waiting";
  const bot = !canAddBot ? null : (
    <button type="button" className="key uno__bot" onClick={() => table.addBot("normal")}>
      Deal in a bot
    </button>
  );
  const taunt = (
    <TauntPicker
      seats={state.seats}
      seatId={seatId}
      chips={chips}
      stakes={table.stakes}
      openClassName="key"
      onThrow={(emote, at) => {
        if (account.profile !== null) {
          account.setChips(account.profile.chips - emote.cost);
        }
        table.taunt(emote.id, at, (result) => {
          if (result.ok) {
            account.setChips(result.chips);
          } else {
            account.refresh();
          }
        });
      }}
    />
  );

  const need = choosing === null ? null : stillNeeds(needsOf(state, choosing.card), choosing);
  const picking =
    choosing === null ? null : need === "color" ? (
      <ColourPicker onPick={(color) => choose({ color })} onCancel={() => setChoosing(null)} />
    ) : need === "target" ? (
      <TargetPicker
        state={state}
        seatId={seatId}
        onPick={(target) => choose({ target })}
        onCancel={() => setChoosing(null)}
      />
    ) : null;

  const log = <ActivityLog entries={activity} />;

  return (
    <section className="uno" aria-label="The table">
      <div className="uno__in">
        <Seats state={state} seatId={seatId} />

        <div className="uno__play">
          <div className="uno__head">
            <span className="uno__ruleset">{state.ruleset}</span>
            {state.round > 0 ? <span className="uno__round">Round {state.round}</span> : null}
            {state.pot > 0 ? (
              <span className="uno__pot">
                Pot <span className="uno__chips">{fmt(state.pot)}</span>
              </span>
            ) : null}
          </div>
          {state.phase === "waiting" ? (
            <p className="quiet uno__quiet">
              {state.forFun ? "Play money, dealt at the table." : `${fmt(state.ante)} each in, the winner takes the pot.`}
            </p>
          ) : (
            <Centre state={state} seatId={seatId} intent={intent} onDraw={draw} />
          )}
          <Moment state={state} />
          <RoundOver state={state} seatId={seatId} />
          {peekOpen ? <PeekCard state={state} onClose={closePeek} /> : null}
          <div className="table-talk-corner">
            <TalkKey open={talk.open} unread={talk.unread} onToggle={toggleTalk} />
          </div>
          <Sheet id={RULES_SHEET_ID} label="How it plays" open={sheet} onClose={() => setSheet(false)} className="sheet--felt">
            <RulesSummary rules={state.rules} ruleset={state.ruleset} />
          </Sheet>
        </div>

        <aside className="uno__side-rules" aria-label="How it plays">
          <h2 className="uno__panel-title">How it plays</h2>
          <RulesSummary rules={state.rules} ruleset={state.ruleset} />
        </aside>

        <aside className="uno__side-activity" aria-label="Activity">
          <h2 className="uno__panel-title">Activity</h2>
          {log}
        </aside>

        <Hand state={state} intent={intent} onPick={pick} />

        <Controls
          state={state}
          seatId={seatId}
          intent={intent}
          picking={picking}
          onDraw={draw}
          onPass={pass}
          onUno={uno}
          onCatch={(seat) => {
            intent.press("catch");
            table.act({ type: "catch", seat });
          }}
          onChallenge={(challenge) => {
            intent.press(challenge ? "challenge" : "accept");
            table.act({ type: "challenge", challenge });
          }}
          onColour={(color) => {
            intent.press("color");
            table.act({ type: "color", color });
          }}
          onReady={(value) => {
            intent.setReady(value);
            table.act({ type: "ready", ready: value });
          }}
          keys={
            <>
              {help}
              {bot}
              {taunt}
            </>
          }
        />
      </div>

      <TalkSheet open={talk.open} onClose={talk.close} log={table.chat} seatId={seatId} onSay={table.say} activity={log} />
    </section>
  );
}

function SignInToJoin({ code, onWatch }: { code: string; onWatch: () => void }) {
  const back = `/auth/discord?to=${encodeURIComponent(`/uno/${code}`)}`;
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
            Chips come from an account, so there is one step before you sit down. Sign in and you will land back at
            this table.
          </p>
          <a className="slab slab--wide slab--discord" href={back}>
            <DiscordIcon />
            <span>Sign in with Discord</span>
          </a>
          <button type="button" className="key key--wide" onClick={onWatch}>
            Just watch this one
          </button>
          <p className="panel__note">
            Or <Link to="/uno">open a table of your own</Link>. A for-fun one deals play money and anybody can sit
            down.
          </p>
        </div>
      </section>
    </div>
  );
}

/** The stake and the rules: the host's choices beyond the seats. */
function Shape({
  stake,
  onStake,
  rules,
  onRules,
}: {
  stake: number;
  onStake: (stake: number) => void;
  rules: Rules;
  onRules: (rules: Rules) => void;
}) {
  return (
    <>
      <div className="lamps uno__pick" role="radiogroup" aria-label="What it costs to sit down">
        {STAKES.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={stake === level}
            className="lamp lamp--chips"
            onClick={() => onStake(level)}
          >
            {fmt(level)}
          </button>
        ))}
      </div>
      <RulesForm rules={rules} onChange={onRules} />
    </>
  );
}

function Sit({ table, invited, account }: { table: Table; invited: string; account: Account }) {
  const [stake, setStake] = useState<number>(ANTE);
  const [rules, setRules] = useState<Rules>(() => officialRules());
  const peek = useTablePeek(invited);
  const waiting = peek.table;
  if (waiting !== null && !waiting.forFun && account.profile === null && !account.loading) {
    return <SignInToJoin code={waiting.code} onWatch={() => table.watch(waiting.code)} />;
  }
  const mode = presetOf(rules)?.name ?? "House rules";

  return (
    <TableSetup
      game="uno"
      pitch="Match the colour or the number, throw a Skip at whoever is winning, and shout UNO when you are down to one."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      seats={{ initial: 4, ceiling: 10 }}
      playsFor={{
        fun: "Play money that lives at the table. Anybody can sit down, and bots will fill the seats.",
        guestWarning:
          "Playing for fun deals you ten thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
      }}
      options={<Shape stake={stake} onStake={setStake} rules={rules} onRules={setRules} />}
      note={({ forFun }) =>
        forFun
          ? `${mode}, and the pot is play money that dies with the table.`
          : `${mode}. Everybody puts ${fmt(stake)} in, and whoever wins the game takes the lot.`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "uno", forFun, maxSeats, buyIn: stake, uno: { ...rules } })
      }
    />
  );
}
