import {
  BIG_HIT,
  FEED_LENGTH,
  FUN_BANK,
  MAX_OTHERS,
  MAX_WAITING,
  MIN_STAKE,
  type Risk,
  capsFor,
  colourOf,
  multText,
} from "@backroom/game-plinko";
import type { PlinkoCaps, PlinkoDrop, PlinkoFloor, PlinkoResult, PlinkoWatcher } from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { play } from "../game/audio.js";
import { exact } from "../game/money.js";
import { useAccount } from "../game/useAccount.js";
import { Seg } from "../fittings/Seg.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { windowId } from "../net/windowId.js";
import { type Ball, Board } from "./Board.js";
import { Controls } from "./Controls.js";
import { Feed } from "./Feed.js";
import { type DropSign, useDrops } from "./useDrops.js";
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

// Re-exported so anything naming this page's own patience does not have to
// know the press → ball → answer arithmetic moved to useDrops.ts.
export { PATIENCE_MS } from "./useDrops.js";

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

/**
 * Prepend a drop to the feed, skipping one already there.
 *
 * A reconnect replaces the whole feed with the floor's own `recent` while a
 * ball somebody else dropped a moment ago may still be falling on this page —
 * its `plinko:dropped` broadcast and the fresh `floor.recent` both name it, and
 * without this it would print twice.
 */
function withDrop(seen: PlinkoDrop[], drop: PlinkoDrop): PlinkoDrop[] {
  if (seen.some((one) => one.id === drop.id)) {
    return seen;
  }
  return [drop, ...seen].slice(0, FEED_LENGTH);
}

export default function Plinko() {
  const account = useAccount();
  const [forFun, setForFun] = useState(false);
  const [risk, setRisk] = useState<Risk>("medium");
  const [stake, setStake] = useState(MIN_STAKE);
  const [sign, setSign] = useState<Sign | null>(null);
  const [funSign, setFunSign] = useState<Sign>({ bank: FUN_BANK, caps: capsFor(FUN_BANK) });
  const [feed, setFeed] = useState<PlinkoDrop[]>([]);
  const [here, setHere] = useState<PlinkoWatcher[]>([]);
  const [connected, setConnected] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  /**
   * The player's own last landed result, said for a screen reader alone.
   *
   * `saidKey` forces the line to be announced even when it repeats itself —
   * the same words twice, from two balls in a row landing on the same
   * multiplier, are two results and not a live region that has nothing new
   * to say. Remounting via `key` is what `Refusal.tsx` does for the same
   * reason.
   */
  const [said, setSaid] = useState<string | null>(null);
  const [saidKey, setSaidKey] = useState(0);
  const balls = useRef(new Map<string, Ball>());
  const socketRef = useRef<PlinkoSocket | null>(null);

  const onSign = useCallback((fun: boolean, next: DropSign) => {
    if (fun) setFunSign(next);
    else setSign(next);
  }, []);

  const emitDrop = useCallback(
    (payload: { stake: number; risk: Risk; forFun?: boolean }, ack: (result: PlinkoResult) => void) => {
      socketRef.current?.emit("plinko:drop", payload, ack);
    },
    [],
  );

  const {
    funPurse,
    busy,
    chipsInAir,
    funInAir,
    notice,
    drop: pressDrop,
    land,
  } = useDrops(emitDrop, account, balls, onSign);

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
        setFeed((seen) => withDrop(seen, drop));
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
    };
  }, []);

  const shown = forFun ? funSign : sign;
  const cap = shown?.caps[risk] ?? 0;
  const balance = forFun ? funPurse : (account.profile?.chips ?? null);
  const limit = Math.min(cap, balance ?? 0);
  const canPlay = forFun || account.profile !== null;
  const inAir = forFun ? funInAir : chipsInAir;
  const canDrop = connected && canPlay && stake >= MIN_STAKE && stake <= limit && inAir < MAX_WAITING;

  const why = !canPlay
    ? "Sign in to play for chips, or play for fun."
    : cap < MIN_STAKE
      ? "The bank is empty. Nothing to play for yet."
      : stake >= cap
        ? `The bank covers ${exact(cap)} a ball on ${risk} right now.`
        : balance !== null && stake > balance
          ? "That is more than you have."
          : balance !== null && stake >= balance
            ? "That is everything you have."
            : notice;

  const drop = () => {
    if (!canDrop) return;
    pressDrop({ fun: forFun, stake, risk });
  };

  const onLand = useCallback(
    (ball: Ball) => {
      if (!ball.mine) {
        const news = ball.news;
        if (news !== undefined) setFeed((seen) => withDrop(seen, news));
        return;
      }
      land(ball.id, ball.fun);
      setSaid(landedLine(ball));
      setSaidKey((n) => n + 1);
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
        setFeed((seen) => withDrop(seen, own));
      }
    },
    [account.profile, land, sign],
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
            <div className="pk-sign__mode">
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
            </div>
            <div className="pk-bank">
              <span className="pk-label">{forFun ? "Play bank" : "Bank"}</span>
              <span className="pk-figure">{shown === null ? "—" : exact(shown.bank)}</span>
            </div>
            <div className="pk-bank">
              <span className="pk-label">{forFun ? "Play chips" : `Up to · ${risk}`}</span>
              <span className="pk-figure">{forFun ? exact(funPurse) : exact(cap)}</span>
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
      <p className="pk-said" aria-live="polite" key={saidKey}>
        {said}
      </p>
    </main>
  );
}
