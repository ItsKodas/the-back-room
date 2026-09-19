import {
  BIG_HIT,
  FEED_LENGTH,
  FUN_BANK,
  FUN_PURSE,
  MAX_OTHERS,
  MAX_WAITING,
  MIN_STAKE,
  type Risk,
  capsFor,
  colourOf,
  multText,
} from "@backroom/game-plinko";
import type { PlinkoCaps, PlinkoDrop, PlinkoFloor, PlinkoResult, PlinkoWatcher } from "@backroom/shared";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { play } from "../game/audio.js";
import { exact } from "../game/money.js";
import { useAccount } from "../game/useAccount.js";
import { Seg } from "../fittings/Seg.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { windowId } from "../net/windowId.js";
import { type Ball, Board } from "./Board.js";
import { Books } from "./books.js";
import { Controls } from "./Controls.js";
import { Feed } from "./Feed.js";
import "@backroom/game-plinko/theme.css";
import "../table/table.css";
import "./plinko.css";

/**
 * The peg board at the bar.
 *
 * Played against its own bank, so a win still comes from real people —
 * everybody who dropped a ball before you — and shared, so you watch everybody
 * else's balls fall beside yours.
 */

/** How long a ball waits on the top peg for its answer before giving up. */
export const PATIENCE_MS = 10_000;

const NO_ANSWER = "No answer from the board. If that ball went through, your balance will catch up.";

type PlinkoSocket = Socket<
  {
    "plinko:dropped": (drop: PlinkoDrop) => void;
    "plinko:here": (here: PlinkoWatcher[]) => void;
  },
  {
    "plinko:watch": (payload: Record<string, never>, ack: (floor: PlinkoFloor) => void) => void;
    "plinko:away": () => void;
    "plinko:drop": (
      payload: { stake: number; risk: Risk; forFun?: boolean },
      ack: (result: PlinkoResult) => void,
    ) => void;
  }
>;

interface Sign {
  bank: number;
  caps: PlinkoCaps;
}

/**
 * What a landed ball says, for the screen reader Board's own SVG cannot reach.
 *
 * Board's win tags live inside an `svg[role="img"]`, which is opaque to
 * assistive tech — an `aria-live` region drawn as SVG text is not announced.
 * This is the same fact in one line of plain text, updated only when the
 * player's own ball lands.
 */
function landedLine(ball: Ball): string {
  const mult = ball.mult ?? 0;
  return `Landed ${multText(mult)}× — won ${exact(ball.won)}`;
}

export default function Plinko() {
  const account = useAccount();
  const [forFun, setForFun] = useState(false);
  const [risk, setRisk] = useState<Risk>("medium");
  const [stake, setStake] = useState(MIN_STAKE);
  const [sign, setSign] = useState<Sign | null>(null);
  const [funSign, setFunSign] = useState<Sign>({ bank: FUN_BANK, caps: capsFor(FUN_BANK) });
  const [funPurse, setFunPurse] = useState(FUN_PURSE);
  const [feed, setFeed] = useState<PlinkoDrop[]>([]);
  const [here, setHere] = useState<PlinkoWatcher[]>([]);
  const [connected, setConnected] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The player's own last landed result, said for a screen reader alone. */
  const [said, setSaid] = useState<string | null>(null);
  /* Books live in refs — they change between frames — and this is how a change is shown. */
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const books = useRef({ chips: new Books(), fun: new Books() });
  const balls = useRef(new Map<string, Ball>());
  const timers = useRef(new Map<string, number>());
  const socketRef = useRef<PlinkoSocket | null>(null);
  const seq = useRef(0);

  /** Put what the books say on the screen, then let them forget if nothing is in play. */
  const push = useCallback(
    (fun: boolean) => {
      const book = fun ? books.current.fun : books.current.chips;
      const shown = book.shown();
      if (shown !== null) {
        if (fun) setFunPurse(shown);
        else account.setChips(shown);
      }
      book.settle();
      redraw();
    },
    [account.setChips],
  );

  useEffect(() => {
    const socket = io("", {
      withCredentials: true,
      auth: { game: "plinko", window: windowId() },
    }) as PlinkoSocket;
    socketRef.current = socket;
    socket.on("connect", () => {
      setTaken(null);
      setConnected(true);
      socket.emit("plinko:watch", {}, (floor) => {
        setFeed(floor.recent);
        setHere(floor.here);
        setSign({ bank: floor.bank, caps: floor.caps });
      });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error: Error) => {
      // A middleware refusal gives up; a transport failure keeps retrying.
      if (!socket.active) setTaken(error.message);
    });
    socket.on("plinko:here", setHere);
    socket.on("plinko:dropped", (drop) => {
      setSign({ bank: drop.bank, caps: capsFor(drop.bank) });
      let others = 0;
      for (const ball of balls.current.values()) if (!ball.mine) others += 1;
      // A busy floor, or a hidden tab, goes straight to the feed: nobody is watching those fall.
      if (others >= MAX_OTHERS || document.hidden) {
        setFeed((seen) => [drop, ...seen].slice(0, FEED_LENGTH));
        return;
      }
      const now = performance.now();
      balls.current.set(drop.id, {
        id: drop.id,
        mine: false,
        colour: drop.by.colour,
        name: drop.by.name,
        risk: drop.risk,
        droppedAt: now,
        path: drop.path,
        answeredAt: now,
        refusedAt: null,
        bucket: drop.bucket,
        mult: drop.mult,
        stake: drop.stake,
        won: drop.won,
        fun: false,
        news: drop,
      });
    });
    return () => {
      socket.emit("plinko:away");
      socket.close();
      socketRef.current = null;
      for (const timer of timers.current.values()) window.clearTimeout(timer);
    };
  }, []);

  const shown = forFun ? funSign : sign;
  const cap = shown?.caps[risk] ?? 0;
  const balance = forFun ? funPurse : (account.profile?.chips ?? null);
  const limit = Math.min(cap, balance ?? 0);
  const book = forFun ? books.current.fun : books.current.chips;
  const canPlay = forFun || account.profile !== null;
  const canDrop =
    connected && canPlay && stake >= MIN_STAKE && stake <= limit && book.inAir() < MAX_WAITING;
  const busy = !books.current.chips.idle() || !books.current.fun.idle();

  const why = !canPlay
    ? "Sign in to play for chips, or play for fun."
    : cap < MIN_STAKE
      ? "The bank is empty. Nothing to play for yet."
      : stake > cap
        ? `The bank covers ${exact(cap)} a ball on ${risk} right now.`
        : balance !== null && stake > balance
          ? "That is more than you have."
          : notice;

  const refuseBall = (id: string) => {
    const ball = balls.current.get(id);
    if (ball !== undefined) ball.refusedAt = performance.now();
  };

  const drop = () => {
    const socket = socketRef.current;
    if (socket === null || !canDrop || balance === null) return;
    seq.current += 1;
    const id = `me-${seq.current}`;
    const fun = forFun;
    const mine = fun ? books.current.fun : books.current.chips;
    setNotice(null);
    // The stake is the player's own number, so it goes on the press.
    mine.press(id, stake, balance);
    push(fun);
    play("bet");
    balls.current.set(id, {
      id,
      mine: true,
      colour: 0,
      name: null,
      risk,
      droppedAt: performance.now(),
      path: null,
      answeredAt: null,
      refusedAt: null,
      bucket: null,
      mult: null,
      stake,
      won: 0,
      fun,
    });
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      mine.giveUp(id);
      refuseBall(id);
      setNotice(NO_ANSWER);
      push(fun);
    }, PATIENCE_MS);
    timers.current.set(id, timer);

    socket.emit("plinko:drop", { stake, risk, ...(fun ? { forFun: true } : {}) }, (result) => {
      const waiting = timers.current.get(id);
      if (waiting === undefined) {
        // Too late to animate, not too late to be true.
        if (result.ok) {
          mine.answer(id, result.balance, 0);
          push(fun);
        }
        return;
      }
      window.clearTimeout(waiting);
      timers.current.delete(id);
      if (!result.ok) {
        mine.refuse(id);
        refuseBall(id);
        setNotice(result.error);
        play("refused");
        push(fun);
        return;
      }
      mine.answer(id, result.balance, result.won);
      push(fun);
      const next = { bank: result.bank, caps: result.caps };
      if (fun) setFunSign(next);
      else setSign(next);
      const ball = balls.current.get(id);
      if (ball !== undefined) {
        ball.path = result.path;
        ball.bucket = result.bucket;
        ball.mult = result.mult;
        ball.won = result.won;
        ball.answeredAt = performance.now();
      }
    });
  };

  const onLand = useCallback(
    (ball: Ball) => {
      if (!ball.mine) {
        const news = ball.news;
        if (news !== undefined) setFeed((seen) => [news, ...seen].slice(0, FEED_LENGTH));
        return;
      }
      const mine = ball.fun ? books.current.fun : books.current.chips;
      mine.land(ball.id);
      push(ball.fun);
      setSaid(landedLine(ball));
      if ((ball.mult ?? 0) >= BIG_HIT) play("spinWin");
      else if (ball.won > 0) play("payout");
      const profile = account.profile;
      if (!ball.fun && profile !== null && ball.path !== null && ball.bucket !== null && ball.mult !== null) {
        const own: PlinkoDrop = {
          id: ball.id,
          by: { name: profile.name, colour: colourOf(profile.id) },
          risk: ball.risk,
          path: [...ball.path],
          bucket: ball.bucket,
          mult: ball.mult,
          stake: ball.stake,
          won: ball.won,
          bank: sign?.bank ?? 0,
          at: Date.now(),
        };
        setFeed((seen) => [own, ...seen].slice(0, FEED_LENGTH));
      }
    },
    [account.profile, push, sign],
  );

  useNav({
    room: "plinko",
    game: (
      <>
        PLINK<em>O</em>
      </>
    ),
    connected,
  });

  if (taken !== null) {
    return (
      <main className="play" data-game="plinko">
        <Taken
          message={taken}
          onRetry={() => {
            setTaken(null);
            socketRef.current?.connect();
          }}
        />
      </main>
    );
  }

  return (
    <main className="play play--fit play--plinko" data-game="plinko">
      <div className="pk-page">
        <div className="pk-in">
          <div className="readout pk-sign">
            <Seg
              label="What this board plays for"
              options={[
                { value: false, text: "For chips" },
                { value: true, text: "For fun" },
              ]}
              value={forFun}
              onChange={setForFun}
              disabled={busy}
            />
            <div className="pk-bank">
              <span className="pk-label">{forFun ? "Play bank" : "Bank"}</span>
              <span className="pk-figure">{shown === null ? "—" : exact(shown.bank)}</span>
            </div>
            <div className="pk-bank">
              <span className="pk-label">{forFun ? "Play chips" : "Up to"}</span>
              <span className="pk-figure">
                {forFun ? exact(funPurse) : `${exact(cap)} on ${risk}`}
              </span>
            </div>
          </div>
          <Feed drops={feed} here={here} />
          <div className="pk-board">
            <Board risk={risk} balls={balls} onLand={onLand} />
          </div>
          <Controls
            risk={risk}
            onRisk={setRisk}
            stake={stake}
            onStake={setStake}
            limit={Math.max(MIN_STAKE, limit)}
            why={why}
            canDrop={canDrop}
            onDrop={drop}
            busy={busy}
          />
        </div>
      </div>
      {/* Board's win tags are SVG text inside role="img", which a screen reader
          never sees. This says the same fact in words, for the player's own ball only. */}
      <p className="pk-said" aria-live="polite">
        {said}
      </p>
    </main>
  );
}
