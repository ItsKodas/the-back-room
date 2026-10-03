import type { BotSpeed, Card, Color, Rules, TableView } from "@backroom/game-uno";
import { ANTE, officialRules, presetOf, STAKES, UNO } from "@backroom/game-uno";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DiscordIcon } from "../blackjack/Icons.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { ActivityLog, useActivity } from "../table/Activity.js";
import { TableSetup } from "../table/TableSetup.js";
import { TalkKey, TalkSheet, useTalk } from "../table/TalkSheet.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import {
  Centre,
  ChallengeModal,
  ColourModal,
  Hand,
  HandControls,
  LogPanel,
  line,
  myTurn,
  needsOf,
  PeekModal,
  RoundModal,
  RulesModal,
  Seats,
  StartColourModal,
  stillNeeds,
  TargetModal,
  Toasts,
  usePeekSeen,
  usePortrait,
  useUnoKeys,
} from "./Felt.js";
import { BotSpeedField, RulesForm } from "./RulesForm.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-uno/theme.css";
import "./uno.css";

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Uno, wired up.
 *
 * The page is Liar's Dice's: a door to sit down at, then a table. What is its
 * own is everything on them, which is the uploaded tabletop's design carried
 * over whole: the logo and cream rules panel at the door, and at the table the
 * oval felt with the seats round its rim, the two piles, your hand fanned
 * along the bottom, and the cream pickers and toasts.
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
      {/* At the table a refusal is one of the tabletop's toasts, over the felt. */}
      {!atTable && table.error !== null ? <p className="play__error">{table.error}</p> : null}

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

type Skill = "easy" | "normal" | "hard";

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
  const portrait = usePortrait();
  const [showRules, setShowRules] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const [skill, setSkill] = useState<Skill>("normal");
  // A refusal this page can say itself, without asking, and how many it has said.
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const [peekOpen, closePeek] = usePeekSeen(state);
  const hand = state.hand;
  const turn = myTurn(state, seatId);

  // The turn moving on throws away a half-chosen card: it may not be playable any more.
  const turnKey = `${state.toAct}:${state.step}:${state.top?.id ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the turn changing, which is the point
  useEffect(() => {
    setChoosing(null);
  }, [turnKey]);

  const refuse = (text: string | null) => {
    if (text !== null) setSaid((was) => ({ text, n: (was?.n ?? 0) + 1 }));
  };

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
    if (hand === null || intent.busy || !turn) return;
    if (!hand.canDraw) {
      refuse(hand.playable.length > 0 ? "You have a playable card — you must play it." : null);
      return;
    }
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

  const need = choosing === null ? null : stillNeeds(needsOf(state, choosing.card), choosing);
  const mine = seatId !== null && state.toAct === seatId;
  const startColour = mine && state.step === "chooseColor" && intent.pressed !== "color";
  const challenge = mine && state.step === "challenge" && intent.pressed !== "challenge" && intent.pressed !== "accept";
  const roundOver = state.phase === "between" || state.phase === "over";
  useUnoKeys({ draw, pass, uno }, !(choosing !== null || startColour || challenge || showRules || peekOpen || roundOver));

  // Only the host, only for fun: a bot has no account to win chips from.
  const canAddBot =
    state.hostId === seatId && state.forFun && state.seats.length < state.maxSeats && state.phase === "waiting";
  const ready = intent.ready ?? state.you?.ready ?? false;
  const between =
    state.phase !== "waiting" ? null : (
      <>
        {canAddBot ? (
          <span className="uno-bot-pick">
            <select aria-label="Bot difficulty" value={skill} onChange={(event) => setSkill(event.target.value as Skill)}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
            <button type="button" className="uno-btn uno-btn--ghost" onClick={() => table.addBot(skill)}>
              Add a bot
            </button>
          </span>
        ) : null}
        {state.you === null ? null : (
          <button
            type="button"
            className={`uno-btn uno-btn--primary${intent.ready !== null ? " is-busy" : ""}`}
            onClick={() => {
              intent.setReady(!ready);
              table.act({ type: "ready", ready: !ready });
            }}
          >
            {ready ? "Waiting for the others…" : "Deal me in"}
          </button>
        )}
      </>
    );

  return (
    <section className="uno-game" aria-label="The table">
      <header className="uno-topbar">
        <div className="uno-topbar__left">
          {state.round === 0 ? (
            <>
              Table {state.code} <span className="uno-muted">· {state.ruleset}</span>
            </>
          ) : (
            <>
              Round {state.round}{" "}
              <span className="uno-muted">
                {state.rules.gameMode === "points" ? `· to ${state.rules.targetScore}` : "· single round"}
              </span>
            </>
          )}
          {state.pot > 0 ? <span className="uno-topbar__pot">Pot {fmt(state.pot)}</span> : null}
        </div>
        <p className="uno-status" aria-live="polite">
          {line(state, seatId)}
        </p>
        <div className="uno-topbar__right">
          <TalkKey open={talk.open} unread={talk.unread} onToggle={talk.toggle} />
          <TauntPicker
            seats={state.seats}
            seatId={seatId}
            chips={chips}
            stakes={table.stakes}
            openClassName="uno-btn uno-btn--ghost uno-btn--sm"
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
          <button type="button" className="uno-btn uno-btn--ghost uno-btn--sm" onClick={() => setShowRules(true)}>
            Rules
          </button>
          <button
            type="button"
            className="uno-btn uno-btn--ghost uno-btn--sm"
            aria-expanded={showLog}
            onClick={() => setShowLog((was) => !was)}
          >
            Log
          </button>
        </div>
      </header>

      <div className="uno-table-wrap">
        <div className="uno-table">
          <div className="uno-felt" />
          {state.phase === "waiting" ? (
            <div className="uno-center">
              <p className="uno-waiting">
                {state.forFun
                  ? "Play money, dealt at the table."
                  : `${fmt(state.ante)} each in, and whoever wins the game takes the pot.`}
              </p>
            </div>
          ) : (
            <Centre state={state} seatId={seatId} intent={intent} onDraw={draw} />
          )}
          <Seats
            state={state}
            seatId={seatId}
            portrait={portrait}
            catching={intent.pressed === "catch"}
            onCatch={(seat) => {
              intent.press("catch");
              table.act({ type: "catch", seat });
            }}
          />
          <Toasts state={state} error={table.error} errorKey={table.errorKey} said={said} />
        </div>
      </div>

      <footer className="uno-hand-area">
        <HandControls
          state={state}
          seatId={seatId}
          intent={intent}
          onDraw={draw}
          onPass={pass}
          onUno={uno}
          extra={between}
        />
        <Hand state={state} seatId={seatId} intent={intent} onPick={pick} onRefused={refuse} />
      </footer>

      {showLog ? <LogPanel entries={activity} onClose={() => setShowLog(false)} /> : null}

      {choosing !== null && need === "color" ? (
        <ColourModal card={choosing.card} onPick={(color) => choose({ color })} onCancel={() => setChoosing(null)} />
      ) : null}
      {choosing !== null && need === "target" ? (
        <TargetModal
          state={state}
          seatId={seatId}
          card={choosing.card}
          onPick={(target) => choose({ target })}
          onCancel={() => setChoosing(null)}
        />
      ) : null}
      {startColour ? (
        <StartColourModal
          onPick={(color) => {
            intent.press("color");
            table.act({ type: "color", color });
          }}
        />
      ) : null}
      {challenge ? (
        <ChallengeModal
          state={state}
          seatId={seatId}
          busy={intent.busy}
          onAnswer={(yes) => {
            intent.press(yes ? "challenge" : "accept");
            table.act({ type: "challenge", challenge: yes });
          }}
        />
      ) : null}
      {peekOpen ? <PeekModal state={state} onClose={closePeek} /> : null}
      <RoundModal state={state} seatId={seatId} />
      {showRules ? <RulesModal rules={state.rules} onClose={() => setShowRules(false)} /> : null}

      <TalkSheet
        open={talk.open}
        onClose={talk.close}
        log={table.chat}
        seatId={seatId}
        onSay={table.say}
        activity={<ActivityLog entries={activity} />}
      />
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

/** The stake, the bots and the rules: the host's choices beyond the seats. */
function Shape({
  stake,
  onStake,
  rules,
  onRules,
  speed,
  onSpeed,
}: {
  stake: number;
  onStake: (stake: number) => void;
  rules: Rules;
  onRules: (rules: Rules) => void;
  speed: BotSpeed;
  onSpeed: (speed: BotSpeed) => void;
}) {
  return (
    <>
      <div className="entry">
        <span className="label" id="uno-stake-label">
          Each player puts in
        </span>
        <div className="lamps" role="radiogroup" aria-labelledby="uno-stake-label">
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
      </div>
      <BotSpeedField value={speed} onChange={onSpeed} />
      <RulesForm rules={rules} onChange={onRules} />
    </>
  );
}

function Sit({ table, invited, account }: { table: Table; invited: string; account: Account }) {
  const [stake, setStake] = useState<number>(ANTE);
  const [rules, setRules] = useState<Rules>(() => officialRules());
  const [speed, setSpeed] = useState<BotSpeed>("normal");
  const peek = useTablePeek(invited);
  const waiting = peek.table;
  if (waiting !== null && !waiting.forFun && account.profile === null && !account.loading) {
    return <SignInToJoin code={waiting.code} onWatch={() => table.watch(waiting.code)} />;
  }
  const mode = presetOf(rules)?.name ?? "House rules";

  return (
    <div className="uno-setup">
      <TableSetup
        game="uno"
        pitch={
          <span className="uno-brand">
            <span className="uno-logo">UNO</span>
            <span className="uno-brand__line">Tabletop edition · 2–{UNO.maxSeats} players</span>
          </span>
        }
        invited={invited}
        account={account}
        busy={table.busy}
        connected={table.connected}
        onJoin={table.join}
        onWatch={table.watch}
        seats={{ initial: 4, ceiling: UNO.maxSeats }}
        playsFor={{
          fun: "Play money that lives at the table. Anybody can sit down, and bots will fill the seats.",
          guestWarning:
            "Playing for fun deals you ten thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
        }}
        options={
          <Shape stake={stake} onStake={setStake} rules={rules} onRules={setRules} speed={speed} onSpeed={setSpeed} />
        }
        note={({ forFun }) =>
          forFun
            ? `${mode}, and the pot is play money that dies with the table.`
            : `${mode}. Everybody puts ${fmt(stake)} in, and whoever wins the game takes the lot.`
        }
        onCreate={(name, { forFun, maxSeats }) =>
          table.create(name, { game: "uno", forFun, maxSeats, buyIn: stake, uno: { ...rules, botSpeed: speed } })
        }
      />
    </div>
  );
}
