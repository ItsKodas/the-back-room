import { REFUSALS } from "@backroom/game-tips";
import type { JarView, TapResult } from "@backroom/shared";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DiscordIcon } from "../blackjack/Icons.js";
import { play } from "../game/audio.js";
import { exact } from "../game/money.js";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "../nav/Navbar.js";
import { ChipFlight, type FlightPoint } from "./ChipFlight.js";
import { Jar, type TapPoint } from "./Jar.js";
import { Upgrades } from "./Upgrades.js";
import "@backroom/game-tips/theme.css";

/**
 * The bar's corner: a jar you tap, and nothing else asking to be watched.
 *
 * The only single-player room in the building that is not playing against a
 * bank — nothing here is staked, so there is no win to come from anybody but
 * the bar itself. What it teaches instead is the building's other rule: a
 * press lands before the table can possibly have answered it.
 */

type TipsSocket = Socket<
  Record<string, never>,
  {
    "tips:open": (payload: Record<string, never>, ack: (jar: JarView) => void) => void;
    "tips:tap": (payload: { token: string }, ack: (result: TapResult) => void) => void;
    "tips:buy": (
      payload: { upgrade: string; token: string },
      ack: (result: TapResult) => void,
    ) => void;
  }
>;

/**
 * How long there is left to tease before an answer that never comes is given
 * up on. A tap already went down on the glass the moment it was pressed, so
 * abandoning it too quickly would take back a scoop that may yet still land;
 * waiting forever would leave the jar quietly lying about what it holds.
 */
const PATIENCE_MS = 10_000;

/**
 * Chips in the jar right now, derived the way the server derives it — from
 * the level a moment ago, that moment, and the trickle since. This is
 * deriving, not inventing: the same arithmetic, run against numbers the last
 * ack already handed over, is what lets a press answer itself before the
 * round trip that would otherwise confirm it.
 */
function levelNow(jar: JarView, now: number): number {
  if (jar.level >= jar.brim) {
    return jar.level;
  }
  const elapsed = Math.max(0, now - jar.at);
  return Math.min(jar.brim, jar.level + (jar.trickle * elapsed) / 60_000);
}

/**
 * When upgrades and favours next clear, said plainly rather than counted
 * down.
 *
 * A ticking countdown would be inventing precision the design never
 * promised — the one rule of the night that costs a player something is
 * worth saying, not narrating second by second. A clock face is calm in a
 * way a countdown is not, and it is right the once: nothing here has to
 * re-render as the minutes pass.
 */
function nightEndsLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function Tips() {
  const account = useAccount();

  /*
   * Which room you are standing in, on the document rather than this
   * element: the page's background lives on body, so a game repainting only
   * its own subtree sits in the building's colours with nothing of its own.
   */
  useEffect(() => {
    document.documentElement.dataset["game"] = "tips";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  /**
   * The server's jar — replaced wholesale by every ack, refusals included.
   * Never touched optimistically: that is the whole fix for the flicker
   * below, because a value only ever written by an ack cannot be stomped by
   * one.
   */
  const [serverJar, setServerJar] = useState<JarView | null>(null);
  const serverJarRef = useRef<JarView | null>(null);
  serverJarRef.current = serverJar;

  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Bumped once per accepted tap, so the jar wobbles exactly once each. */
  const [tapped, setTapped] = useState(0);
  const [displayLevel, setDisplayLevel] = useState(0);
  /**
   * Taps applied to the display but not yet answered.
   *
   * Taps are chained — the client cannot send tap two until tap one's ack
   * hands back the next token — so tap two is already on the glass,
   * optimistically, while tap one is still in flight. Overlaying this count
   * on top of the server's jar, rather than folding each tap into one
   * mutable "current" jar, is what lets tap one's ack land without erasing
   * tap two's still-unconfirmed scoop.
   */
  const [pendingTaps, setPendingTaps] = useState(0);
  const pendingTapsRef = useRef(0);

  /**
   * Chips currently arcing out of the jar, one per accepted tap.
   *
   * A list rather than a single "current flight": taps can land faster than
   * one flight takes to finish, and each one keeps travelling once thrown —
   * a fast run of taps is several chips in the air at once, not one chip
   * restarting its trip.
   */
  const [flights, setFlights] = useState<Array<{ id: number; from: FlightPoint; to: FlightPoint }>>(
    [],
  );
  const flightIdRef = useRef(0);
  /** Where a flight lands — the same figure the counter itself ticks on. */
  const tonightRef = useRef<HTMLElement | null>(null);

  const socketRef = useRef<TipsSocket | null>(null);
  /**
   * Taps and buys, sent one at a time.
   *
   * The token is a compare-and-swap key the server rotates on every answer,
   * refusals included — so two requests in flight at once would race for it,
   * and the loser would come back refused for a reason that has nothing to do
   * with what it actually asked. Queuing rather than firing in parallel is
   * what keeps every request carrying a token that is still good.
   */
  const queueRef = useRef<Array<() => void>>([]);
  const sendingRef = useRef(false);
  const patienceRef = useRef<number | null>(null);

  const clearPatience = () => {
    if (patienceRef.current !== null) {
      window.clearTimeout(patienceRef.current);
      patienceRef.current = null;
    }
  };

  /** An answer landed, refusal or not: the jar it carries is now the truth. */
  const applyResult = (result: TapResult) => {
    clearPatience();
    serverJarRef.current = result.jar;
    setServerJar(result.jar);
    if (result.ok) {
      setMessage(null);
      account.setChips(result.balance);
    } else {
      setMessage(result.error);
    }
  };

  const pump = () => {
    if (sendingRef.current) {
      return;
    }
    const next = queueRef.current.shift();
    if (next === undefined) {
      return;
    }
    sendingRef.current = true;
    patienceRef.current = window.setTimeout(() => {
      // The house rule: anything shown early is given up on if the table
      // never speaks. Everything still queued is abandoned with it — a
      // second tap that went down while the first was already stuck is no
      // more trustworthy than the first was.
      queueRef.current = [];
      sendingRef.current = false;
      patienceRef.current = null;
      // Every queued tap is abandoned with the stuck one, so none of their
      // optimism belongs on the glass any more — the server's own jar is
      // untouched and already the truth to fall back to.
      pendingTapsRef.current = 0;
      setPendingTaps(0);
      setMessage("The jar did not answer. Nothing was taken.");
    }, PATIENCE_MS);
    next();
  };

  const enqueue = (action: () => void) => {
    queueRef.current.push(action);
    pump();
  };

  useEffect(() => {
    const socket = io("", { withCredentials: true }) as TipsSocket;
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("tips:open", {}, (view) => {
        serverJarRef.current = view;
        setServerJar(view);
      });
    });
    socket.on("disconnect", () => setConnected(false));
    return () => {
      socket.close();
      socketRef.current = null;
      // A round trip still out when the page is left is one nobody is
      // waiting on any more — the timer that would otherwise fire on an
      // unmounted page is cleared here rather than left to run down. Cleared
      // inline rather than through `clearPatience`: that closure is recreated
      // every render and this effect only ever wants to run once, on mount.
      if (patienceRef.current !== null) {
        window.clearTimeout(patienceRef.current);
        patienceRef.current = null;
      }
      queueRef.current = [];
      sendingRef.current = false;
    };
  }, []);

  /*
   * The creep: the one thing on this page genuinely still happening, so the
   * one thing allowed to animate continuously. With motion off there is no
   * loop — the level is only ever redrawn on a tap or an ack, which turns the
   * creep into a step instead of taking it away outright.
   */
  const [reducedMotion] = useState(prefersReducedMotion);
  useEffect(() => {
    if (serverJar === null) {
      return;
    }
    // The overlay: pending taps' scoops taken off the top of the server's
    // own creeping level, floored so a run of optimistic taps never shows
    // the glass going negative. Read from the state rather than the ref, so
    // a change in pending taps is itself a reason for this effect to redraw
    // — needed for the reduced-motion branch below, which only ever draws
    // once per run rather than on every frame.
    const withOverlay = (source: JarView, now: number) =>
      Math.max(0, levelNow(source, now) - pendingTaps * source.scoop);
    if (reducedMotion) {
      setDisplayLevel(withOverlay(serverJar, Date.now()));
      return;
    }
    let frame = 0;
    const tick = () => {
      const current = serverJarRef.current ?? serverJar;
      setDisplayLevel(withOverlay(current, Date.now()));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [serverJar, reducedMotion, pendingTaps]);

  const doTap = (point: TapPoint) => {
    const socket = socketRef.current;
    const server = serverJarRef.current;
    if (socket === null || server === null) {
      return;
    }
    const now = Date.now();
    // What the glass is actually showing right now — the server's own creep
    // minus every scoop already claimed by a tap still waiting on an ack —
    // is what a new tap has to be checked and paid against, not the raw
    // server figure alone.
    const available = Math.max(0, levelNow(server, now) - pendingTapsRef.current * server.scoop);
    const pay = Math.floor(Math.min(server.scoop, available));
    if (pay < 1) {
      // The client can already tell the jar is dry from the same numbers the
      // server would use — not a guess, the same arithmetic — so this is said
      // at once rather than sent off to be refused for the same reason. No
      // sound, no chip — nothing left the jar, so nothing is shown leaving it.
      setMessage(REFUSALS.dry);
      return;
    }
    setMessage(null);
    setTapped((n) => n + 1);
    // The press, shown before the table can possibly have answered it: one
    // more pending tap, overlaid on the server's jar rather than folded into
    // a mutable copy of it.
    pendingTapsRef.current += 1;
    setPendingTaps(pendingTapsRef.current);

    // The scoop is deterministic — both sides compute it from the same
    // JarView — so this is a fact the client already knows, not a guess: the
    // chip leaves and the clink sounds on the press, the same instant the
    // level itself drops, rather than waiting on a round trip that would
    // only ever confirm what was already certain.
    //
    // Not "payout" — that cue is a counted stack, the loudest chip sound in
    // the building, meant to land once at the end of a hand. A full jar is
    // dozens of scoops, so what has to survive a fast run of taps is the
    // smallest single-object clink there is, not the one built for a total.
    play("coin");
    const target = tonightRef.current?.getBoundingClientRect();
    if (!reducedMotion && target !== undefined) {
      flightIdRef.current += 1;
      const id = flightIdRef.current;
      const to: FlightPoint = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      };
      setFlights((current) => [...current, { id, from: point, to }]);
    }

    enqueue(() => {
      // Read fresh rather than closed over: by the time this actually sends,
      // an earlier queued action may have already moved the token on.
      const token = serverJarRef.current?.token ?? server.token;
      socket.emit("tips:tap", { token }, (result) => {
        // This tap's guess is answered either way — refusal or not, its
        // contribution to the overlay is spent, whatever applyResult does
        // with the server's jar underneath it.
        pendingTapsRef.current = Math.max(0, pendingTapsRef.current - 1);
        setPendingTaps(pendingTapsRef.current);
        applyResult(result);
        sendingRef.current = false;
        pump();
      });
    });
  };

  const doBuy = (id: string) => {
    const socket = socketRef.current;
    if (socket === null || serverJarRef.current === null) {
      return;
    }
    enqueue(() => {
      const token = serverJarRef.current?.token ?? "";
      socket.emit("tips:buy", { upgrade: id, token }, (result) => {
        applyResult(result);
        sendingRef.current = false;
        pump();
      });
    });
  };

  return (
    <main className="tips" data-game="tips">
      <Navbar
        game={
          <>
            TIP <em>J</em>AR
          </>
        }
        account={account}
        connected={connected}
      />

      {account.loading ? null : account.profile === null ? (
        <SignInToTap available={account.available} />
      ) : serverJar === null ? (
        <p className="tips__loading">Walking over to the bar&hellip;</p>
      ) : (
        <div className="tips__floor">
          <Jar level={displayLevel} brim={serverJar.brim} onTap={doTap} tapped={tapped} />

          {/* Chips still arcing out of the jar. Fixed-position, so where in
              the tree this sits does not matter — each one is keyed by its
              own id so React never reuses one flight's element for another
              still-running one. */}
          {flights.map((flight) => (
            <ChipFlight
              key={flight.id}
              from={flight.from}
              to={flight.to}
              onDone={() => setFlights((current) => current.filter((f) => f.id !== flight.id))}
            />
          ))}

          {/* Said, not proven — a message here is a courtesy, never the rule
              the server just applied. */}
          <p className="tips__said" role="status" aria-live="polite">
            {message}
          </p>

          <div className="tips__figures">
            <p className="tips__figure">
              <span className="tips__figure-label">Tonight</span>
              <b className="tips__figure-value" data-testid="tonight" ref={tonightRef}>
                {/* The server's own figure plus what every still-pending tap
                    would pay — the same overlay the glass itself wears. */}
                {exact(serverJar.chipsTonight + pendingTaps * serverJar.scoop)}
              </b>
            </p>
            <p className="tips__figure">
              <span className="tips__figure-label">Favours</span>
              <b className="tips__figure-value" data-testid="favours">
                {exact(serverJar.favours)}
              </b>
            </p>
          </div>

          {/* The one rule of the night that costs a player something: what is
              bought and earned in favours does not survive the turnover. Said
              once, in the same quiet register as everything else on the
              page, not counted down. */}
          <p className="tips__night">
            Upgrades and favours reset at {nightEndsLabel(serverJar.nightEndsAt)}.
          </p>

          <Upgrades bought={serverJar.bought} favours={serverJar.favours} onBuy={doBuy} />
        </div>
      )}
    </main>
  );
}

/**
 * A jar you have to be somebody to tap.
 *
 * The jar lives on an account, so there is one step before the glass. Not a
 * refusal — the same one step every other chips game asks for.
 */
function SignInToTap({ available }: { available: boolean }) {
  return (
    <section className="housing gate tips__gate" aria-labelledby="tips-gate-title">
      <div className="housing__body">
        <h2 className="gate__title" id="tips-gate-title">
          The jar keeps a tab
        </h2>
        <p className="gate__note">
          What you tap goes to an account, so there is one step before you can. Sign in and you
          will land back here.
        </p>
        {available ? (
          <a className="slab slab--wide slab--discord" href="/auth/discord?to=%2Ftips">
            <DiscordIcon />
            <span>Sign in with Discord</span>
          </a>
        ) : (
          <p className="panel__note">Signing in is not set up on this server.</p>
        )}
      </div>
    </section>
  );
}
