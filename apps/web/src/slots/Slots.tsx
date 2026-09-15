import type { Face } from "@backroom/game-slots";
import {
  CHIPS,
  FUN_BANK,
  FUN_PURSE,
  jackpotPay,
  maxStake,
  MIN_STAKE,
  PAYLINES,
  runOn,
  STAKE_DIVISOR,
} from "@backroom/game-slots";
import type { SpinLine, SpinNews, SpinResult } from "@backroom/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DiscordIcon } from "../blackjack/Icons.js";
import { play, riser, startLoop } from "../game/audio.js";
import { Avatar } from "../game/Avatar.js";
import { Chip } from "../chips/Chip.js";
import { ChipStack } from "../chips/ChipStack.js";
import { useAccount } from "../game/useAccount.js";
import { exact } from "../game/money.js";
import { Navbar } from "../nav/Navbar.js";
import { Digits } from "../game/Digits.js";
import { Taken } from "../net/Taken.js";
import { windowId } from "../net/windowId.js";
import { Fireworks } from "./Fireworks.js";
import { Paytable } from "./Paytable.js";
import { RoomFireworks } from "./RoomFireworks.js";
import { Reel, REEL_STAGGER_MS } from "./Reel.js";
import { FaceDefs } from "./Symbols.js";
import "@backroom/game-slots/theme.css";
import "./slots.css";

/**
 * The machine against the wall.
 *
 * The only game in the building played alone, and the only one allowed to be:
 * it pays from a bank that players alone fill, so a win here still comes from
 * real people — everybody who pulled the lever before you.
 */

/*
 * Everything on this cabinet is chips.
 *
 * It read in credits at a hundred to the chip for a while, on the argument
 * that a machine saying 500 feels more like a slot machine than one saying 5.
 * That argument is not worth what it costs: a player cannot tell what they are
 * playing for when the stake and the prize are in different units, and the
 * moment any figure here is a chip they all have to be. Chips are what the
 * rest of the building counts in, so chips it is.
 */

/**
 * How long auto-spin waits after a spin that paid, on top of the celebration.
 *
 * Long enough to read what happened and decide to stop. Auto used to switch
 * itself off instead, which enforced the same thing by making the player rearm
 * the machine every time it did something good.
 */
export const AFTER_A_WIN_MS = 6000;

/** The ordinary beat between two spins the machine pulls for itself. */
export const BETWEEN_SPINS_MS = 500;

/**
 * How long auto-spin waits before pulling again.
 *
 * A beat between spins rather than straight into the next one — back to back,
 * the reels never visibly stop and it stops being a game being played and
 * becomes a screen doing something. Much longer after a spin that paid, on top
 * of the celebration it has already sat through, so the player gets a look at
 * it and a chance to stop.
 *
 * A spin that won free spins and no chips counts as paying. It is one of the
 * better things that happens here, and reading `won` alone would walk straight
 * past it.
 */
export function autoBeatMs(landed: { won: number; awarded: number } | null): number {
  const paid = landed !== null && (landed.won > 0 || landed.awarded > 0);
  return paid ? AFTER_A_WIN_MS : BETWEEN_SPINS_MS;
}

/*
 * How far a win spills off the machine and out over the page.
 *
 * The glass celebrates every line, however small — that is the machine
 * answering you. The room joins in only for something worth turning round
 * for, and then in proportion: a win ten times the stake gets a few shells
 * out of the sides, one a hundred times gets a barrage. Anything past that
 * is the same barrage, because a cap here is the difference between a big
 * win and a page nobody can see the reels through.
 */

/** The multiple of the stake a win has to clear before the room joins in. */
const ROOM_BAR = 10;
/**
 * The multiple at which the show is as big as a line can make it.
 *
 * A hundred times the stake is roughly five diamonds across nine lines, which
 * is the top of the paytable — so the whole range is spent on wins that can
 * actually happen rather than on ones that cannot.
 */
const ROOM_TOP = 100;
/** Shells at the bar, and at the top. */
const ROOM_LEAST = 3;
const ROOM_MOST = 14;
/** The jackpot, which outranks anything a line can do. */
const ROOM_JACKPOT = 18;

export function roomShow({
  won,
  /**
   * What the spin cost — which is *not* its stake on a free one, where
   * nothing left the account. Sized off the stake, every free spin would be
   * dividing by nothing; sized off the bet it replays, a free spin that pays
   * fifty times gets the fifty-times show it earned.
   */
  bet,
  jackpot,
}: {
  won: number;
  bet: number;
  jackpot: boolean;
}): number {
  if (jackpot) {
    return ROOM_JACKPOT;
  }
  if (bet <= 0 || won < bet * ROOM_BAR) {
    return 0;
  }
  /*
   * Logarithmic between the two, because the wins are: the gap from ten times
   * to twenty is the same kind of step up as twenty to forty, and a straight
   * line would spend nearly all its shells on the wins nobody ever sees.
   */
  const climb = Math.log(won / bet / ROOM_BAR) / Math.log(ROOM_TOP / ROOM_BAR);
  return Math.round(ROOM_LEAST + Math.min(climb, 1) * (ROOM_MOST - ROOM_LEAST));
}

/** How long after the last reel stops before the winning lines light. */
export const LINE_LIGHT_MS = 420;

/**
 * How long a win is left to be looked at before the lever comes back.
 *
 * A machine that will take your next stake while it is still counting out the
 * last one is hurrying you past the only part worth watching. So the lever
 * stays down until the lines have lit and the coins have finished.
 */
export function celebrationMs(
  won: number,
  jackpot: boolean,
  lit: number,
  /**
   * Free spins this pull just won.
   *
   * A spin can win a run of them and pay nothing at all, and that is one of
   * the better things that happens on this machine — so it cannot be the case
   * that "paid nothing" means "nothing to watch".
   */
  awarded = 0,
): number {
  if (won <= 0 && awarded <= 0) {
    return 0;
  }
  if (jackpot) {
    return 2600;
  }
  if (awarded > 0) {
    // Long enough to read the number and understand what just happened.
    return 2000;
  }
  // The lines light one after another, so more of them is a longer look.
  return Math.min(2200, LINE_LIGHT_MS + 700 + lit * 90);
}

/**
 * How many paylines a machine arrives with bought.
 *
 * One of the four the picker offers, so the machine never opens on a number a
 * player cannot get back to.
 */
export const DEFAULT_LINES = 3;

/** The line counts the picker offers, fewest first. */
export const LINE_CHOICES = [1, 3, 5, 9] as const;

/** The reels, named so each keeps its identity across a spin. */
const REEL_NAMES = ["one", "two", "three", "four", "five"] as const;

/**
 * What the cabinet shows before anybody has pulled anything.
 *
 * Not a result, and it cannot be mistaken for one: neighbouring reels are
 * drawn from two disjoint sets of faces, so no run of two can start anywhere
 * on any payline, let alone a run of three. Dimmed by the stylesheet, with
 * nothing lit and nothing said.
 */
const ATTRACT: Face[][] = [
  ["tumbler", "cigar", "dice"],
  ["spade", "diamond", "seven"],
  ["dice", "tumbler", "cigar"],
  ["seven", "spade", "diamond"],
  ["cigar", "dice", "tumbler"],
];

/**
 * The run of bonuses landing in one spin.
 *
 * Each one sounds a note above the last, and the run belongs to the spin: the
 * point of it is "that is the second one on the glass, and a third would pay",
 * which is a sentence about this spin and nothing else. Carried across, the
 * first bonus of the evening is the only one that ever sounds its own note.
 *
 * A tiny object rather than a number in a ref, because the rule worth holding
 * is when it goes back to nought, and a counter that has to be reset by
 * whoever remembers is a counter that eventually is not.
 *
 * A free spin does not climb. Free spins cannot win more of them, so "a third
 * would pay" is not true on one, and a run of rising notes ending in nothing
 * sounds like the machine forgot to pay. The bonuses still land with a note;
 * it is only the promise that goes.
 */
export function bonusRun(): { landed: () => number; reset: (free?: boolean) => void } {
  let seen = 0;
  let flat = false;
  return {
    /** One has just arrived: how far up the run it is, counting it in. */
    landed: () => {
      const at = seen;
      if (!flat) {
        seen += 1;
      }
      return at;
    },
    reset: (free = false) => {
      seen = 0;
      flat = free;
    },
  };
}

/**
 * Which cells sit on a line that paid.
 *
 * A win is the machine's answer to "what landed?", and a line drawn over the
 * glass only half answers it — it says where, not what. So the faces that
 * earned it move, each in its own way, and the ones that did not hold still.
 *
 * Only as far along as the run went: a line that paid three of a kind lit its
 * first three reels and nothing after, because the fourth face is exactly the
 * one that ended it.
 */
export function winningCells(lines: readonly SpinLine[]): boolean[][] {
  const cells: boolean[][] = Array.from({ length: 5 }, () => [false, false, false]);
  for (const { line, length } of lines) {
    const rows = PAYLINES[line];
    if (rows === undefined) {
      continue;
    }
    for (let reel = 0; reel < length && reel < rows.length; reel += 1) {
      const row = rows[reel];
      const column = cells[reel];
      if (row !== undefined && column !== undefined) {
        column[row] = true;
      }
    }
  }
  return cells;
}

/**
 * How long the machine waits for an answer before giving up on it.
 *
 * Generous, because a slow reply is still a reply and throwing away a spin
 * that was about to land is worse than a long wait. But not forever: without
 * this the lever stays down and the machine is dead until the page is
 * reloaded, which is the one failure a player cannot work around.
 */
const PATIENCE_MS = 10_000;

/** How much longer the first held reel takes when the answer rides on it. */
export const HOLD_MS = 1300;

/**
 * How much longer again each further held reel takes.
 *
 * The tease has to get worse, not merely continue. Two reels held for the same
 * length is a machine that has slowed down; each one taking longer than the
 * last is a machine drawing it out, which is the thing being paid for.
 */
export const HOLD_STEP_MS = 550;

/**
 * Longer still when what is riding on it is the jackpot face.
 *
 * Sevens are the only face whose five-across is not in the paytable at all —
 * it pays a share of the bank instead — so a live run of them is the biggest
 * moment this machine has, and the one worth making somebody wait for.
 */
export const HOLD_TOP_MS = 550;

/**
 * Which reels to take your time over, and for how long.
 *
 * The server has already said what every reel holds, so nothing here is
 * guessed — this only chooses how long the machine takes to say it, which is
 * exactly what a real one does when the first three have come up sevens.
 *
 * Worth holding for: a big face already three across, or anything four across
 * with one reel left. Small faces three across are a win but not a moment.
 *
 * The length is not flat, and that is the whole point of it. A hold that was
 * the same 900ms whether you were one reel from three cheap ones or one reel
 * from the jackpot said the same thing about both, which is to say it said
 * nothing. The wait now grows with how much is actually riding on it: further
 * along the run, and longer again when the run is sevens.
 */
export function holdsFor(grid: Face[][]): number[] {
  let best = 0;
  /* Whether any live run is on the jackpot face, which is worth extra rope. */
  let jackpot = false;
  for (const line of PAYLINES) {
    const { face, length } = runOn(grid, line);
    const worth = length >= 4 || (length >= 3 && (face === "seven" || face === "diamond"));
    if (worth) {
      best = Math.max(best, length);
      jackpot ||= face === "seven";
    }
  }
  // The deciding reel is the one the run has reached; hold it, and reel four
  // as well once the run is long enough to still be alive when it lands.
  return [0, 1, 2, 3, 4].map((reel) =>
    reel >= 3 && reel <= best
      ? HOLD_MS + (reel - 3) * HOLD_STEP_MS + (jackpot ? HOLD_TOP_MS : 0)
      : 0,
  );
}

/**
 * How long there is left to tease, from the moment one reel lands.
 *
 * The rising note is supposed to climb for exactly as long as the answer is
 * still out, and it was being handed the wrong number: the next reel's hold,
 * which is not a gap between two landings but a total measured from the start
 * of the spin. So the sweep finished early and then sat at the top droning
 * until the last reel arrived — the sound stopped rising well before the thing
 * it was supposed to be raising the tension of.
 *
 * A reel lands at `SPIN_UP_MS + index * REEL_STAGGER_MS + hold`, so the gap
 * between two of them is the difference, and the common start cancels out.
 * Zero when nothing further is being held, which is the caller's signal that
 * there is nothing to play.
 */
export function teaseMs(holds: readonly number[], from: number): number {
  let last = -1;
  for (let reel = from + 1; reel < holds.length; reel += 1) {
    if ((holds[reel] ?? 0) > 0) {
      last = reel;
    }
  }
  if (last === -1) {
    return 0;
  }
  return (last - from) * REEL_STAGGER_MS + (holds[last] ?? 0) - (holds[from] ?? 0);
}

/**
 * The figure the machine puts on its screen.
 *
 * Just the number: the screen labels it "Paid" or "Jackpot" above, so carrying
 * the word down here would print it twice.
 */
function sayWhat(won: number): string | null {
  return won > 0 ? exact(won) : null;
}

/** The tray, smallest first, because it reads left to right. */
const TRAY = [...CHIPS].reverse();

interface MachineSign {
  bank: number;
  maxStake: number;
  jackpot: number;
}

type SpinSocket = Socket<
  { "slots:spun": (news: SpinNews) => void },
  {
    "slots:spin": (
      payload: { stake: number; lines?: number; forFun?: boolean },
      ack: (result: SpinResult) => void,
    ) => void;
    "slots:watch": (payload: Record<string, never>, ack: (recent: SpinNews[]) => void) => void;
    "slots:away": () => void;
  }
>;

/** What a machine playing for nothing shows before its first pull. */
const FUN_SIGN: MachineSign = {
  bank: FUN_BANK,
  maxStake: maxStake(FUN_BANK),
  jackpot: jackpotPay(FUN_BANK),
};

export default function Slots() {
  const account = useAccount();
  /*
   * Which room you are standing in, on the document rather than this element:
   * the page's background and its haze live on body, so a game repainting only
   * its own subtree sits in the building's blue with a violet rectangle in it.
   */
  useEffect(() => {
    document.documentElement.dataset["game"] = "slots";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  const [sign, setSign] = useState<MachineSign | null>(null);
  const [grid, setGrid] = useState<Face[][] | undefined>(undefined);
  /**
   * Bonuses landed so far this spin, which is what pitches the next one.
   *
   * A ref rather than state: it changes as each reel stops and nothing renders
   * from it, so putting it in state would be five renders a spin to redraw
   * nothing.
   */
  const scattered = useRef(bonusRun());
  /**
   * A balance the player has been paid but has not been shown yet.
   *
   * Held from the moment the answer lands until the celebration finishes, so
   * the number climbs while the coins are counting out rather than before the
   * reels have stopped. Null whenever there is nothing owed, which is every
   * spin that did not pay.
   */
  const owed = useRef<number | null>(null);
  /**
   * Rows the wall has been told about but has not shown yet.
   *
   * Same reason as `owed`: the answer is in long before the reels have
   * finished saying it, and the feed would say it first.
   */
  const held = useRef<SpinNews[]>([]);
  /**
   * Whether the machine is mid-spin, readable from the socket handler.
   *
   * The handler is registered once, so it closes over the first render's
   * `settling` for ever. A ref is the only thing it can ask.
   */
  const settlingNow = useRef(false);

  const [lines, setLines] = useState<SpinLine[]>([]);
  const [lit, setLit] = useState(false);

  /*
   * Recomputed only when the lines change or they light. Five reels' worth of
   * booleans is nothing to work out, but this is read on every render of a
   * page with five reels turning on it, and a fresh array each time would give
   * every reel a new prop sixty times a second.
   */
  const won = useMemo(() => winningCells(lit ? lines : []), [lit, lines]);
  const [spinning, setSpinning] = useState(false);
  const [stake, setStake] = useState(0);
  /** Which machine: the one that pays chips, or the one that pays nothing. */
  const [forFun, setForFun] = useState(false);
  /** The play purse, which lives at the machine and never sees an account. */
  const [funPurse, setFunPurse] = useState(FUN_PURSE);

  /**
   * Show a balance that was already paid.
   *
   * Called when the celebration ends, and again at the start of the next pull
   * in case anything skipped it — leaving a player looking at a balance that
   * is short by their last win is far worse than showing it a beat early.
   */
  const payOut = useCallback(() => {
    if (held.current.length > 0) {
      const waiting = held.current;
      held.current = [];
      setNews((seen) => [...waiting, ...seen].slice(0, 24));
    }
    const paid = owed.current;
    owed.current = null;
    if (paid === null) {
      return;
    }
    if (forFun) {
      setFunPurse(paid);
      return;
    }
    account.setChips(paid);
  }, [account.setChips, forFun]);
  const [funSign, setFunSign] = useState<MachineSign>(FUN_SIGN);
  /** What everybody else at the machine has been doing. */
  const [news, setNews] = useState<SpinNews[]>([]);
  /** How long each reel is being held, which is only ever a reveal. */
  const [holds, setHolds] = useState<number[]>([0, 0, 0, 0, 0]);
  /**
   * Bumped once per win, and how big a show it earns.
   *
   * A counter rather than a flag: two wins running are two shows, and a
   * boolean that was already true would light nothing the second time.
   */
  const [fired, setFired] = useState(0);
  const [showSize, setShowSize] = useState(1);
  /**
   * How many shells the win throws out over the page, which is nearly always
   * none. Off the same counter as the glass — one win is one moment, and a
   * second counter would be the room and the machine celebrating separately.
   */
  const [roomSize, setRoomSize] = useState(0);
  /** The cabinet, so the room's fireworks know which edges to leave from. */
  const cabinet = useRef<HTMLDivElement | null>(null);
  /**
   * The jackpot's own show, over the screen at the top.
   *
   * Its own counter rather than the same one: the glass gets fireworks for
   * every win, and the marquee only ever for the one that matters. Sharing a
   * counter would set the top of the machine off over three chips.
   */
  const [jackpotFired, setJackpotFired] = useState(0);
  /**
   * Whether the machine is pulling its own handle.
   *
   * Turns itself off the moment something pays, which is the whole point of
   * it: a machine left running through a win is one nobody watched win.
   */
  const [auto, setAuto] = useState(false);
  /**
   * Whether the row has settled.
   *
   * Kept apart from `settling` below, and that separation is the point: this
   * is the reels finishing, that is the whole pull finishing. Sharing one flag
   * is what made the winning lines wait for the payout they were supposed to
   * open.
   */
  const [stopped, setStopped] = useState(false);
  /**
   * Whether a pull is still playing out.
   *
   * Not the same as waiting on the server, and that difference is the whole
   * point of it: the answer lands long before the reels finish saying it, so a
   * lever that came back the moment the socket replied was live for two
   * seconds while the machine was visibly still spinning.
   *
   * Runs from the press to the last reel settling, and is what the lever and
   * the winning lines both wait on.
   */
  const [settling, setSettling] = useState(false);
  // Kept in step every render, because the socket handler cannot see state.
  settlingNow.current = settling;
  /**
   * How many of the nine lines are being bought.
   *
   * The chips on the tray are the bet *per line*, so this multiplies what
   * leaves the account. A line nobody bought does not pay however it lands,
   * which is the whole meaning of choosing fewer.
   */
  /*
   * Three to start with: enough that the machine is playable the moment you
   * walk up to it, and small enough that it has not made a large decision
   * about somebody's money before they touched it. Nine would be that
   * decision — it trebles what a spin costs — and nought meant every player
   * had to work out what a payline was before the lever would move at all.
   */
  const [lineCount, setLineCount] = useState(DEFAULT_LINES);
  /** Whether the paytable is open over the machine. */
  const [readingPays, setReadingPays] = useState(false);
  /** Whether the spin on the glass was the jackpot, for what the belly says. */
  const [wasJackpot, setWasJackpot] = useState(false);
  /** Gives up on an answer that never comes, so the machine cannot lock. */
  const patience = useRef<number | null>(null);
  /** The spin loop and the rising note, so whatever started them can end them. */
  const reelsLoop = useRef<(() => void) | null>(null);
  const rising = useRef<(() => void) | null>(null);
  /** The result, kept for the moment the last reel finally settles. */
  const landed = useRef<{
    won: number;
    jackpot: boolean;
    stake: number;
    /**
     * What the spin would have cost, which is what the stake is on a paid one
     * and is *not* zero on a free one. Kept apart from the stake because the
     * stake is a fact about the account — chips that left it — and this is a
     * fact about the spin. Only the size of the celebration reads it: a free
     * spin paying fifty times its bet is worth the same show as a paid one,
     * and a stake of zero cannot say that.
     */
    bet: number;
    lit: number;
    awarded: number;
  } | null>(
    null,
  );
  const [said, setSaid] = useState<string | null>(null);
  /** Something refused. Separate from what a spin paid, and said straight away. */
  const [problem, setProblem] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /**
   * The server's reason for turning this window away, or null. Apart from
   * `connected` on purpose: one says wait, the other says go and close a tab.
   */
  const [taken, setTaken] = useState<string | null>(null);
  /*
   * The stake, gone from the shown balance the moment it is pressed.
   *
   * A stake is the player's own number, so it can be shown at once — unlike
   * anything the reels say, which is only the server's to tell. Cleared when
   * the answer lands and the real balance replaces it.
   */
  const [pending, setPending] = useState(0);
  /**
   * Free spins the machine owes, as the server last counted them.
   *
   * Shown, never trusted. The server decides whether a pull costs anything and
   * says so in the answer; this is only what the cabinet puts on the glass so
   * the player knows what is happening. A client that decided its own spins
   * were free would be a client that decided a balance.
   */
  const [freeLeft, setFreeLeft] = useState(0);
  /**
   * Free spins this pull just won, as opposed to how many are left.
   *
   * Its own number because the screen says something different about each:
   * "eight free spins" is news, "seven left" is a status. Cleared when the
   * next pull starts, the way every other thing the screen says is.
   */
  const [awarded, setAwarded] = useState(0);
  const socketRef = useRef<SpinSocket | null>(null);

  useEffect(() => {
    const socket = io("", {
      withCredentials: true,
      // One machine per account. The server needs the game and the window to
      // tell a refresh from a second one of these.
      auth: { game: "slots", window: windowId() },
    }) as SpinSocket;
    socketRef.current = socket;
    socket.on("connect", () => {
      setTaken(null);
      setConnected(true);
      // Stand at the machine. The backlog comes back with the ack, so the
      // wall is never briefly blank for somebody who has just walked up.
      socket.emit("slots:watch", {}, (recent) => setNews(recent));
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error: Error) => {
      /*
       * socket.io keeps retrying a transport failure and gives up on a
       * middleware refusal, so `active` is what tells the two apart. Only the
       * second is this window being turned away; the first is a connection to
       * wait out, and dressing it as a refusal would tell somebody to close a
       * tab they do not have open.
       */
      if (!socket.active) {
        setTaken(error.message);
      }
    });
    socket.on("slots:spun", (spun) => {
      /*
       * Held while this machine is still turning.
       *
       * The feed is fed by the server, which knows the answer the moment the
       * spin resolves — so a player's own row lands on the wall, win and all,
       * while their reels are still going round. It is the same giveaway as a
       * balance that jumps early, and a worse one: the row says the figure.
       *
       * Everybody's rows wait, not just this player's. Whose row it is cannot
       * be told apart from here without matching on a name, and a stranger's
       * spin arriving a second and a half late costs nothing.
       */
      if (settlingNow.current) {
        held.current = [spun, ...held.current];
        return;
      }
      setNews((seen) => [spun, ...seen].slice(0, 24));
    });
    return () => {
      socket.emit("slots:away");
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const readSign = useCallback(() => {
    void fetch("/api/slots")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: MachineSign | null) => {
        if (body !== null) {
          setSign(body);
        }
      })
      .catch(() => {
        // A sign that will not answer keeps whatever it last said. There is
        // nothing a player could do about it either way.
      });
  }, []);

  useEffect(() => {
    readSign();
    // Somebody else's jackpot changes this number, so it should not need a
    // refresh to notice.
    const timer = window.setInterval(readSign, 15_000);
    return () => window.clearInterval(timer);
  }, [readSign]);

  const shown = forFun ? funSign : sign;
  const cap = shown?.maxStake ?? 0;
  const balance = forFun
    ? funPurse - pending
    : account.profile === null
      ? null
      : account.profile.chips - pending;
  /*
   * What actually leaves the account: a bet on every line bought. The chips on
   * the tray are the bet *per line*, which is how a machine with selectable
   * lines has to work — otherwise choosing fewer would quietly make each one
   * worth more rather than making the spin cheaper.
   */
  const total = stake * lineCount;
  /*
   * A spin the machine already owes is pullable on its own. Nothing is being
   * staked, so a tray that cannot cover one, a line count nobody has chosen
   * and a cap below the replayed bet are all beside the point — the server
   * plays the bet that won the free spins and checks the bank itself.
   */
  const owedSpin = freeLeft > 0;
  const canPull =
    connected &&
    !settling &&
    (owedSpin ||
      (lineCount >= 1 &&
        stake >= MIN_STAKE &&
        total <= cap &&
        balance !== null &&
        total <= balance));

  /** Whether one more of this chip could go on: the bank's ceiling and yours. */
  /*
   * Costed against one line until lines are chosen, so the tray is usable
   * before the picker has been touched rather than either dead or lying.
   */
  const perSpin = (amount: number) => (stake + amount) * Math.max(1, lineCount);
  const canAdd = (amount: number) =>
    !settling && perSpin(amount) <= cap && balance !== null && perSpin(amount) <= balance;

  /**
   * Everything the machine is making a noise about, stopped.
   *
   * One place, called from every way a spin can end — settled, refused, mode
   * changed, page left. A loop is the one sound that does not stop itself, so
   * every exit has to go through here or the machine spins forever in the
   * dark.
   */
  const hush = useCallback(() => {
    reelsLoop.current?.();
    reelsLoop.current = null;
    rising.current?.();
    rising.current = null;
    if (patience.current !== null) {
      window.clearTimeout(patience.current);
      patience.current = null;
    }
  }, []);

  // Whatever is running, it does not outlive the page.
  useEffect(() => hush, [hush]);

  /**
   * Coins into the tray for a moment, then quiet.
   *
   * A loop rather than a burst of one-shots because a payout is one continuous
   * sound, and stopped on a timer because how long it runs is a question about
   * the size of the win rather than the length of the file.
   */
  const payingOut = useCallback((ms: number) => {
    const stop = startLoop("coins", 0.5);
    window.setTimeout(stop, ms);
  }, []);

  /** One reel has settled. */
  /**
   * One reel has settled.
   *
   * The last one hands over to the celebration rather than running it here:
   * the lines, the sound and the lever coming back are one sequence, and
   * scattering them across two places is how they drifted apart.
   */
  const reelStopped = useCallback(
    (index: number) => {
      play("reelStop");

      /*
       * A bonus arriving, and the run of them climbing.
       *
       * Counted here as the reels land rather than read off the finished grid,
       * because that is when it is worth hearing: two of these while a reel is
       * still turning is the most interesting moment this machine has, and a
       * player should be able to hear the third one coming.
       *
       * By reel rather than by cell. One stop on the strip means a reel cannot
       * show two today, so the two counts are the same number — but a reel
       * that somehow showed a stacked pair should sound like one reel
       * scattering, which is what the paytable would count it as.
       */
      if (grid?.[index]?.includes("bonus") === true) {
        play("bonusAppear", scattered.current.landed());
      }

      /*
       * The answer still rides on a reel that has not landed, so the note
       * starts climbing — and climbs for the whole of what is left rather than
       * for the next reel alone. With two reels held it used to top out
       * somewhere in the middle and drone at its peak through the very moment
       * it was there to build up to.
       */
      const left = teaseMs(holds, index);
      if (left > 0 && rising.current === null) {
        rising.current = riser(left / 1000);
      }

      if (index < 4) {
        return;
      }
      // The last one. Everything that was running stops.
      hush();
      play("spinEnd");
      setStopped(true);
    },
    [grid, holds, hush],
  );

  /*
   * What happens once the row has settled.
   *
   * Keyed on the reels stopping, and nothing else. It used to wait on
   * `settling`, which by then also covered the celebration — so the lines
   * waited for the whole payout to finish before they started, and lit a
   * second and a half after the sound that was supposed to accompany them.
   *
   * The beat before they light is deliberate: a row of reels that have only
   * just stopped needs a moment to be read before something is drawn over it.
   * The sound goes with the lines rather than ahead of them, because they are
   * the same event.
   */
  useEffect(() => {
    if (!stopped) {
      return;
    }
    /*
     * Read, not taken. An earlier version cleared this here, which made the
     * effect destroy its own input: React runs effects twice in development,
     * so the second pass found nothing, read the win as a loss and cancelled
     * the celebration. Every win was swallowed and the machine just carried on.
     *
     * `pull` clears it at the start of the next spin, which is the only place
     * that should.
     */
    const result = landed.current;
    if (result === null || (result.won <= 0 && result.awarded <= 0)) {
      /*
       * Nothing to watch, so the lever comes straight back — but the wall
       * still has to be let go of. Rows are held for the whole of a spin, and
       * a spin that paid nothing ends here rather than at the celebration;
       * without this they would wait for the next pull, and for a player who
       * has stopped spinning, for ever.
       */
      payOut();
      setSettling(false);
      return;
    }

    const show = window.setTimeout(() => {
      setLit(true);
      /*
       * Sized to the win, so an ordinary line is a couple of shells and a
       * jackpot is a barrage. The same show every time would make every win
       * feel identical, which is the one thing a payout must not do.
       */
      /*
       * Sized against what the spin cost, which is nothing on a free one — so
       * "twenty times the stake" has to be asked as a question with an answer.
       * Left as a bare comparison it reads as true for every free spin,
       * including the ones that paid nothing at all.
       */
      const big = result.stake > 0 && result.won >= result.stake * 20;
      setShowSize(result.jackpot ? 3 : big || result.awarded > 0 ? 2 : 1);
      setRoomSize(roomShow({ won: result.won, bet: result.bet, jackpot: result.jackpot }));
      setFired((n) => n + 1);
      if (result.jackpot) {
        setJackpotFired((n) => n + 1);
      }

      /*
       * How the money arrives, sized to how much of it there is. A handful of
       * coins for an ordinary line, a run of them for something worth looking
       * up at — the same sound at the same length for both would make every
       * win feel identical, which is the one thing a payout must not do.
       */
      if (result.jackpot) {
        play("jackpot");
        play("bonus");
        payingOut(2400);
        return;
      }
      /*
       * The bonus, which is worth a noise of its own whatever else the spin
       * did. Ahead of the win sound because a run of free spins is the bigger
       * news, and a player who has just triggered one should hear that first.
       */
      if (result.awarded > 0) {
        play("bonus");
        if (result.won > 0) {
          play("spinWin");
        }
        payingOut(1800);
        return;
      }
      play("spinWin");
      if (big) {
        // Not a bonus round — the machine has none. A flourish for a win big
        // enough to deserve one.
        play("bonus");
        payingOut(1400);
        return;
      }
      for (let coin = 0; coin < 3; coin += 1) {
        window.setTimeout(() => play("coin"), coin * 130 + Math.random() * 60);
      }
    }, LINE_LIGHT_MS);

    /*
     * Held down while the win plays out. Taking a stake over the top of a
     * payout hurries the player past the part they are here for.
     */
    const done = window.setTimeout(() => {
      // The chips arrive last, and the counter climbs to meet them.
      payOut();
      setSettling(false);
    }, LINE_LIGHT_MS + celebrationMs(result.won, result.jackpot, result.lit, result.awarded));
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(done);
    };
  }, [stopped, payingOut, payOut]);

  /*
   * Held in a ref so the loop below does not restart on every render. `pull`
   * closes over the stake and the mode and is rebuilt constantly; watching it
   * would make the effect fire on its own.
   */
  const pullRef = useRef<() => void>(() => {});

  /*
   * The machine pulling its own handle.
   *
   * How long it waits is `autoBeatMs`: an ordinary beat between spins, and a
   * long one after a spin that paid. It used to switch itself off after a win
   * instead, which enforced the same thing — a win the player did not see
   * happen is a win that did not happen to them — by making them rearm the
   * machine every time it did something good.
   *
   * `landed` still holds what the last spin did: this effect wakes when the
   * celebration ends, and nothing clears it until the next pull.
   *
   * It arms nothing on its own: any of the conditions that stop a person
   * spinning stop this too, because it goes through exactly the same canPull.
   */
  useEffect(() => {
    if (!auto || settling || !canPull) {
      return;
    }
    const next = window.setTimeout(() => pullRef.current(), autoBeatMs(landed.current));
    return () => window.clearTimeout(next);
  }, [auto, settling, canPull]);

  const changeMachine = (next: boolean) => {
    if (next === forFun || spinning) {
      return;
    }
    /*
     * A clean start at the other machine. Carrying the reels across would show
     * a result from a game that was not this one, and carrying the stake would
     * put chips on the felt of a machine the player has only just walked up to.
     */
    hush();
    setSettling(false);
    setAuto(false);
    setForFun(next);
    setStake(0);
    setGrid(undefined);
    setLines([]);
    setLit(false);
    setWasJackpot(false);
    setSaid(null);
    setProblem(null);
    setAwarded(0);
    scattered.current.reset();
  };

  const pull = () => {
    const socket = socketRef.current;
    if (socket === null || !canPull) {
      return;
    }
    /*
     * Everything the player chose, shown on the press. The reels start
     * turning, the stake leaves the balance, and nothing here guesses at a
     * face — the reels show a blur until the server says what stopped where.
     */
    payOut();
    setSpinning(true);
    setGrid(undefined);
    setLines([]);
    setLit(false);
    setSaid(null);
    /*
     * The run of rising notes belongs to this spin and no other. Left to
     * carry over, the first bonus of the evening is the only one that sounds
     * its own note: every spin after it starts wherever the last one stopped,
     * and once five have landed the pitch is pinned at the top for good.
     */
    scattered.current.reset();
    // A spin the machine already owes takes nothing, so nothing goes down.
    setPending(freeLeft > 0 ? 0 : total);
    setHolds([0, 0, 0, 0, 0]);
    setSettling(true);
    setStopped(false);
    landed.current = null;

    play("lever");
    /*
     * Under the whole spin, and stopped by whichever reel settles last.
     *
     * A tenth. It is a bed rather than an event: it runs for two solid seconds
     * every pull, and anything loud enough to notice becomes the thing you
     * hear instead of what is landing on top of it — the five reel stops, and
     * now the bonus notes, which are the ones carrying the news.
     */
    reelsLoop.current?.();
    reelsLoop.current = startLoop("reels", 0.1);

    /*
     * An answer that never comes. The house rule is that anything shown early
     * is given up on if the table never speaks — so the reels stop turning,
     * the stake goes back on the glass, and the lever comes up.
     */
    patience.current = window.setTimeout(() => {
      patience.current = null;
      hush();
      setSpinning(false);
      setSettling(false);
      setPending(0);
      setProblem("The machine did not answer. Nothing was staked.");
    }, PATIENCE_MS);

    socket.emit(
      "slots:spin",
      { stake: total, lines: lineCount, ...(forFun ? { forFun: true } : {}) },
      (result) => {
      if (patience.current !== null) {
        window.clearTimeout(patience.current);
        patience.current = null;
      }
      setSpinning(false);
      setPending(0);
      if (!result.ok) {
        // Refused: the stake was never taken, so the glass goes back to what
        // it was showing rather than sitting on a spin that did not happen —
        // and the machine stops making the noise of a spin.
        hush();
        setSettling(false);
        setProblem(result.error);
        readSign();
        return;
      }
      const grid = result.grid as Face[][];
      /*
       * Whether this spin was free is the server's to say, not the button's:
       * the run can be forfeit or finished by the time the answer comes. It
       * arrives before any reel lands, which is all the notes need.
       */
      scattered.current.reset(result.wasFree);
      setGrid(grid);
      setFreeLeft(result.freeLeft);
      setAwarded(result.awarded);
      setLines(result.lines);
      /*
       * Set with the grid, in the same render, so the reels read their hold
       * before they schedule anything. A hold arriving a render later would be
       * a reel that had already decided when to stop.
       */
      setHolds(holdsFor(grid));
      setWasJackpot(result.jackpot);
      landed.current = {
        won: result.won,
        jackpot: result.jackpot,
        stake: result.wasFree ? 0 : total,
        bet: total,
        lit: result.lines.length,
        awarded: result.awarded,
      };
      if (forFun) {
        // Same rule as the account below: the stake has gone, the win waits
        // for the reels. This machine teaches the other one, so it cannot
        // count out its money on a different beat.
        setFunPurse(result.balance - result.won);
        owed.current = result.won > 0 ? result.balance : null;
        setFunSign({
          bank: result.bank,
          maxStake: maxStake(result.bank),
          jackpot: jackpotPay(result.bank),
        });
        setSaid(sayWhat(result.won));
        return;
      }
      /*
       * Recomputed here from the arithmetic the server used rather than
       * hard-coded, so the sign cannot drift from the cap. The server is still
       * the authority — it checks the stake itself and refuses one it cannot
       * cover; this only decides what to offer.
       */
      setSign({
        bank: result.bank,
        maxStake: maxStake(result.bank),
        jackpot: jackpotPay(result.bank),
      });
      /*
       * The stake has left, but the win has not arrived yet.
       *
       * The server has already paid it — `result.balance` includes it, and the
       * account is the server's to decide. What is deferred is only the
       * *showing* of it: a counter that jumps the moment the answer lands is a
       * counter that has told the player what the reels are still turning to
       * say, and by the time the coins are counting out the number has been
       * right for two seconds and nobody watched it move.
       *
       * So the balance goes to what it was with the stake gone and the win not
       * yet in, and `owed` carries the rest until the celebration is over.
       */
      account.setChips(result.balance - result.won);
      owed.current = result.won > 0 ? result.balance : null;
      setSaid(sayWhat(result.won));
    });
  };

  /*
   * The lines light after the last reel has settled, not with it. A win drawn
   * across reels that are still turning is a win the player cannot read.
   *
   * Hung off the reel actually stopping rather than off a sum of the timings.
   * The sum stopped being true the moment a reel could be held back: on a spin
   * with sevens up, the lines were lighting while the last reel was still
   * turning — giving away the answer the hold exists to withhold.
   */
  pullRef.current = pull;

  const columns: (Face[] | undefined)[] = [0, 1, 2, 3, 4].map((reel) => grid?.[reel]);
  // Signed in, or playing for nothing — either way there is a machine to play.
  const canPlay = forFun || account.profile !== null;

  return (
    <main className="slots" data-game="slots">
      <Navbar
        game={
          <>
            SL<em>O</em>TS
          </>
        }
        account={account}
        connected={connected}
      />

      {taken !== null ? (
        <Taken
          message={taken}
          onRetry={() => {
            setTaken(null);
            socketRef.current?.connect();
          }}
        />
      ) : (
        <div className="slots__floor">
          <SpinFeed
            title="At the machine"
            empty="Nobody has pulled it yet."
            news={news}
            side="left"
          />

          <div className="slots__cabinet" ref={cabinet}>
            {/* Behind the page rather than on the machine: the shells leave the
                sides of the cabinet and burst out in the room either side of
                it, and only for a win worth turning round for. */}
            <RoomFireworks fire={fired} shells={roomSize} from={cabinet} />
            <div className="slots__top">
              <ModeSwitch forFun={forFun} onChange={changeMachine} busy={settling} />
              {/* Open mid-spin too: reading what a run is worth while the reels
                  land is exactly when somebody wants to know. */}
              <button
                type="button"
                className="slots__paysbtn"
                data-quiet
                aria-label="Paytable"
                title="Paytable"
                onClick={() => setReadingPays(true)}
              >
                ?
              </button>
            </div>
            <Paytable
              open={readingPays}
              onClose={() => setReadingPays(false)}
              stake={stake}
              lineCount={lineCount}
              jackpot={shown?.jackpot ?? 0}
            />

            {/*
              * The machine itself: a marquee over glass over a belly, with the
              * handle bolted down the side. Drawn as one object rather than a
              * stack of panels, because a slot machine is a thing you stand in
              * front of and everything on this page is part of it.
              */}
            <div className="cab">
              <div className="cab__body">
                <div className="cab__marquee">
                  {/* Only ever for the jackpot. The glass below celebrates every
                      win; the top of the machine keeps its powder dry. */}
                  <Fireworks fire={jackpotFired} scale={3} />
                  <Marquee
                    bank={shown?.bank ?? 0}
                    jackpot={shown?.jackpot ?? 0}
                    forFun={forFun}
                    said={said}
                    problem={problem}
                    lines={lines}
                    wasJackpot={wasJackpot}
                    showing={lit}
                    awarded={awarded}
                    freeLeft={freeLeft}
                  />
                </div>

                <div className="cab__glass">
                  {/* Over the glass, under nothing: it takes no pointer events
                      and occupies no space in the layout. */}
                  <Fireworks fire={fired} scale={showSize} />
                  <div className="slots__glass">
                    <FaceDefs />
                    {columns.map((column, reel) => (
                      <Reel
                        // Five fixed positions; what changes is the faces in one.
                        key={REEL_NAMES[reel]}
                        column={column}
                        spinning={spinning}
                        index={reel}
                        resting={ATTRACT[reel]}
                        holdMs={holds[reel] ?? 0}
                        won={won[reel]}
                        onStop={() => reelStopped(reel)}
                      />
                    ))}
                    <PaylineOverlay lines={lit ? lines : []} />
                  </div>
                </div>

                <div className="cab__belly">
                  {canPlay ? (
                    <Controls
                      stake={stake}
                      onAdd={(amount) => setStake((on) => on + amount)}
                      onClear={() => setStake(0)}
                      canAdd={canAdd}
                      busy={settling}
                      balance={balance ?? 0}
                      cap={cap}
                      forFun={forFun}
                      lineCount={lineCount}
                      onLines={setLineCount}
                      total={total}
                      onPull={pull}
                      canPull={canPull}
                      freeLeft={freeLeft}
                      auto={auto}
                      onAuto={() => setAuto((on) => !on)}
                    />
                  ) : (
                    <SignInToPlay available={account.available} />
                  )}
                </div>

                {/* Where the coins would land. Empty, and that is the point: it
                    is the bottom edge of a machine rather than a panel — which
                    is why it runs to the cabinet's edges rather than sitting
                    inside them. */}
                <div className="cab__tray" aria-hidden="true" />
              </div>

            </div>
          </div>

          <SpinFeed
            title="Paying out"
            empty="No wins yet."
            news={winningSpins(news)}
            side="right"
          />
        </div>
      )}
    </main>
  );
}

/**
 * Whether a spin left the player up.
 *
 * Not the same question as whether the machine paid: five lines at 500 is
 * 2,500 on the felt, and a single line coming in at 2,000 is the reels
 * handing chips back to somebody who is still down five hundred. Both columns
 * ask this one question, so a row can never be green in the sum and absent
 * from the wins.
 */
export function cameOutAhead(spun: SpinNews): boolean {
  return spun.won > spun.stake;
}

/** The right-hand column: the spins that actually left somebody up. */
export function winningSpins(news: SpinNews[]): SpinNews[] {
  return news.filter(cameOutAhead);
}

/**
 * What other people are doing at the machine.
 *
 * Only chips spins reach here, so the wall is an honest picture of the room:
 * a for-fun purse was never anybody's, and counting it would advertise a
 * machine busier than it is.
 *
 * Two of these, either side. The left is everything as it happens and the
 * right is only what somebody came out ahead on, so a quiet room still has one
 * column with something in it and a busy one reads twice over.
 *
 * Both write the same figure: what the spin did to the player's account. Not
 * what the reels handed over — a row saying the machine paid 2,000 on a stake
 * of 2,500 is a row telling somebody they won five hundred chips less than
 * nothing.
 */
export function SpinFeed({
  title,
  empty,
  news,
  side,
}: {
  title: string;
  empty: string;
  news: SpinNews[];
  side: "left" | "right";
}) {
  return (
    <aside className={`feed feed--${side}`} aria-label={title}>
      <p className="feed__label">{title}</p>
      {news.length === 0 ? (
        <p className="feed__empty">{empty}</p>
      ) : (
        <ul className="feed__list">
          {news.slice(0, 8).map((spun) => {
            // Negative numbers write their own sign; only a win needs one adding.
            const net = spun.won - spun.stake;
            return (
              <li
                key={spun.id}
                className={`feed__row${spun.jackpot ? " feed__row--jackpot" : ""}`}
              >
                <Avatar name={spun.name} avatar={spun.avatar} accentColor={null} className="feed__face" />
                <span className="feed__who">{spun.name}</span>
                <span className="feed__sum">
                  {cameOutAhead(spun) ? (
                    <b className="feed__won">+{exact(net)}</b>
                  ) : (
                    <span className="feed__lost">{exact(net)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/**
 * What paid, and for what.
 *
 * A figure on its own tells a player they won without telling them why, and a
 * slot machine that cannot be read is a slot machine nobody trusts. This is
 * the same information the reels are showing, in words: the run, the face, the
 * line it landed on, and what that came to.
 */
function WinBreakdown({ lines, jackpot }: { lines: SpinLine[]; jackpot: boolean }) {
  if (lines.length === 0 && !jackpot) {
    return null;
  }

  /*
   * Grouped by what actually happened rather than listed line by line.
   *
   * Three chips across can light six paylines at once, and six rows saying
   * "3 x Chip" one after another is the same sentence six times — it filled
   * the belly of the machine and said nothing the first row had not. The glass
   * is already showing *which* lines lit, so the words only have to say what
   * landed and what it came to.
   */
  const groups = new Map<string, { face: string; length: number; count: number; paid: number }>();
  for (const line of lines) {
    const key = `${line.face}-${line.length}`;
    const seen = groups.get(key) ?? { face: line.face, length: line.length, count: 0, paid: 0 };
    seen.count += 1;
    seen.paid += line.pay;
    groups.set(key, seen);
  }
  const best = [...groups.values()].sort((a, b) => b.paid - a.paid);

  return (
    <ul className="won">
      {jackpot ? (
        <li className="won__row won__row--jackpot">
          <span className="won__what">Five sevens — the jackpot</span>
        </li>
      ) : null}
      {best.map((group) => (
        <li className="won__row" key={`${group.face}-${group.length}`}>
          <span className="won__what">
            {group.length} × {group.face}
          </span>
          {group.count > 1 ? <span className="won__lines">on {group.count} lines</span> : null}
          <span className="won__pay">{exact(group.paid)}</span>
        </li>
      ))}
    </ul>
  );
}

/** An arrow curving back on itself: chips coming off the felt. */
function TakeBackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="take__icon">
      <title>Take back</title>
      <path
        d="M20 17a7 7 0 0 0-7-7H5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path d="M9 5.5 4 10l5 4.5Z" fill="currentColor" />
    </svg>
  );
}

/** Two arrows chasing each other: the machine going round again. */
function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="auto__icon">
      <title>Repeat</title>
      <path
        d="M4 9a6 6 0 0 1 6-6h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path d="M14 0.5 18.5 3 14 5.5Z" fill="currentColor" transform="translate(0 0)" />
      <path
        d="M20 15a6 6 0 0 1-6 6H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path d="M10 18.5 5.5 21 10 23.5Z" fill="currentColor" />
    </svg>
  );
}

/** How many of the nine lines to buy. */
function LinePicker({
  lines,
  onChange,
  disabled,
  perLine,
}: {
  lines: number;
  onChange: (lines: number) => void;
  disabled: boolean;
  perLine: number;
}) {
  return (
    <div className="picker">
      <span className="picker__label">Lines</span>
      <div className="picker__row" role="radiogroup" aria-label="How many paylines">
        {LINE_CHOICES.map((count) => (
          <button
            key={count}
            type="button"
            role="radio"
            aria-checked={lines === count}
            className={`picker__pick${lines === count ? " picker__pick--on" : ""}`}
            disabled={disabled}
            onClick={() => onChange(count)}
          >
            {count}
          </button>
        ))}
      </div>
      {/* What it actually costs, because two numbers multiplied is exactly the
          sort of arithmetic a machine should not make anybody do. */}
      <span className={`picker__cost${lines === 0 ? " picker__cost--asking" : ""}`}>
        {lines === 0
          ? "Pick your lines"
          : `${exact(perLine)} a line — ${exact(perLine * lines)} a spin`}
      </span>
    </div>
  );
}

/**
 * The screen across the top of the machine.
 *
 * A status display rather than a jackpot sign. At rest it shows what there is
 * to play for, because that is the reason anybody is standing here; the moment
 * a spin says something it shows that instead, and goes back when the next
 * pull starts.
 *
 * One screen doing both is how a real cabinet works, and it is also the only
 * place on the machine a message can go without pushing the reels down the
 * page every time somebody wins.
 */
export function Marquee({
  bank,
  jackpot,
  forFun,
  said,
  problem,
  lines,
  wasJackpot,
  showing,
  awarded,
  freeLeft,
}: {
  bank: number;
  jackpot: number;
  forFun: boolean;
  /** What the last spin paid. Only ever shown once the reels have stopped. */
  said: string | null;
  /** Something refused, which may be said at any time. */
  problem: string | null;
  lines: SpinLine[];
  wasJackpot: boolean;
  /** Whether the reels have finished and the outcome may be shown. */
  showing: boolean;
  /** Free spins this pull won, which is news rather than a status. */
  awarded: number;
  /** Free spins still owed, which is a status rather than news. */
  freeLeft: number;
}) {
  /*
   * The bonus takes the screen when it happens, ahead of whatever the lines
   * paid. A run of free spins is the bigger thing, and a spin can win one
   * while paying nothing at all — which the old condition, "did any line
   * pay?", would have shown as an ordinary losing spin.
   */
  const bonus = showing && awarded > 0;
  const outcome = showing && !bonus && (lines.length > 0 || wasJackpot);
  /*
   * Kept apart from the outcome on purpose. The answer is in long before the
   * reels finish saying it, so a screen that printed the figure as soon as it
   * arrived would give away what the last reel is still hiding — which is the
   * one thing this machine must not do.
   */
  const message = problem !== null && !outcome;

  return (
    <div
      className={`screen${forFun ? " screen--fun" : ""}${wasJackpot && showing ? " screen--jackpot" : ""}`}
      aria-live="polite"
    >
      {bonus ? (
        <>
          <span className="screen__label">Bonus</span>
          <strong className="screen__figure">
            <Digits value={String(awarded)} />
          </strong>
          <p className="screen__note">
            {lines.length > 0 || wasJackpot
              ? `free spins, and ${said ?? "0"} on the lines`
              : "free spins, on the house"}
          </p>
        </>
      ) : outcome ? (
        <>
          <span className="screen__label">{wasJackpot ? "Jackpot" : "Paid"}</span>
          <strong className="screen__figure">
            <Digits value={said ?? "0"} />
          </strong>
          <WinBreakdown lines={lines} jackpot={wasJackpot} />
        </>
      ) : message ? (
        <>
          <span className="screen__label">The machine says</span>
          <p className="screen__note screen__note--said">{problem}</p>
        </>
      ) : freeLeft > 0 ? (
        <>
          {/* What the machine owes takes the screen over what it is playing
              for: a player mid-run needs to know how much of it is left. */}
          <span className="screen__label">Free spins left</span>
          <strong className="screen__figure">
            <Digits value={String(freeLeft)} />
          </strong>
          <p className="screen__note">pull for the next one — it costs nothing</p>
        </>
      ) : (
        <>
          <span className="screen__label">Jackpot</span>
          <strong className="screen__figure">
            <Digits value={exact(jackpot)} />
          </strong>
          <p className="screen__note">
            {forFun
              ? `of ${exact(bank)} in the bank — play money, and none of it anybody's`
              : bank === 0
                ? "The bank has not been stocked yet, so the machine is shut."
                : `of ${exact(bank)} in the bank — every chip of it staked by somebody`}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The winning lines, drawn only as far as each run actually reached.
 *
 * A line drawn the whole width for a run of three is the machine claiming a
 * win the player cannot see on the glass, which is worse than not drawing one.
 */
export function PaylineOverlay({ lines }: { lines: SpinLine[] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <svg
      className="paylines"
      viewBox="0 0 500 300"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lines.map((line) => (
        <polyline
          key={line.line}
          className="payline"
          data-line={line.line}
          data-length={line.length}
          points={pointsFor(line)}
          style={{ animationDelay: `${line.line * 90}ms` }}
        />
      ))}
    </svg>
  );
}

/** The nine lines, in the overlay's own coordinates. */
const OVERLAY_LINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];

function pointsFor(line: SpinLine): string {
  const rows = OVERLAY_LINES[line.line] ?? OVERLAY_LINES[0] ?? [];
  return rows
    .slice(0, line.length)
    .map((row, reel) => `${reel * 100 + 50},${row * 100 + 50}`)
    .join(" ");
}

/** Which machine you are standing at. */
function ModeSwitch({
  forFun,
  onChange,
  busy,
}: {
  forFun: boolean;
  onChange: (forFun: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="slots__modes" role="radiogroup" aria-label="What this machine plays for">
      {[false, true].map((fun) => (
        <button
          key={fun ? "fun" : "chips"}
          type="button"
          role="radio"
          aria-checked={forFun === fun}
          className={`slots__mode${forFun === fun ? " slots__mode--on" : ""}`}
          // Not mid-spin: the reels are answering a question this would change.
          disabled={busy}
          onClick={() => onChange(fun)}
        >
          {fun ? "For fun" : "For chips"}
        </button>
      ))}
    </div>
  );
}

/**
 * The tray, the bet, and the lever.
 *
 * Chips are built up rather than picked from, the way they are at a card
 * table: press the hundred four times and four hundred is on. It is the same
 * gesture in both rooms, and it is the one that lets somebody make a stake the
 * house never thought to offer.
 *
 * A stake stays put between spins, because a slot machine keeps your bet.
 */
export function Controls({
  stake,
  onAdd,
  onClear,
  canAdd,
  busy,
  balance,
  cap,
  forFun,
  lineCount,
  onLines,
  total,
  onPull,
  canPull,
  auto,
  onAuto,
  freeLeft,
}: {
  stake: number;
  onAdd: (amount: number) => void;
  onClear: () => void;
  canAdd: (amount: number) => boolean;
  busy: boolean;
  balance: number;
  cap: number;
  forFun: boolean;
  lineCount: number;
  onLines: (lines: number) => void;
  /** Free spins the machine still owes, counted down as they are used. */
  freeLeft: number;
  total: number;
  onPull: () => void;
  canPull: boolean;
  auto: boolean;
  onAuto: () => void;
}) {
  /* What one more of a chip would make the whole spin cost. */
  const perSpin = (amount: number) => (stake + amount) * Math.max(1, lineCount);

  if (cap < MIN_STAKE) {
    return (
      <p className="slots__shut">
        {/* Derived, not typed in. This read 1296 until the paytable was
            retuned for the bonus, at which point it was quietly understating
            what the bank needs by about a tenth. */}
        The bank cannot cover a {exact(MIN_STAKE)} spin yet. It needs{" "}
        {exact(MIN_STAKE * STAKE_DIVISOR)} in it before the smallest chip goes on.
      </p>
    );
  }

  return (
    <div className="slots__controls">
      <LinePicker lines={lineCount} onChange={onLines} disabled={busy} perLine={stake} />

      <div className="slots__tray" data-quiet>
        {TRAY.map((amount) => (
          <button
            key={amount}
            type="button"
            className="slots__chip"
            disabled={!canAdd(amount)}
            title={
              perSpin(amount) > cap
                ? `The bank cannot cover ${exact(perSpin(amount))} yet`
                : `Add ${exact(amount)} a line`
            }
            onClick={() => onAdd(amount)}
          >
            <Chip amount={amount} size={54} />
          </button>
        ))}
      </div>

      {/* The pile you have built, beside the figure. The number is the exact
          answer; the stack is the one you can read without counting. */}
      <div className={`slots__bet${stake > 0 ? " slots__bet--on" : ""}`}>
        {stake > 0 && lineCount > 0 ? (
          <>
            <ChipStack amount={total} width={64} />
            <span className="slots__bet-total">{exact(total)}</span>
            {/*
              * A control rather than a line of underlined text, but with the
              * word kept: on its own the arrow was a guess, and this is the
              * one button here that undoes something.
              */}
            <button
              type="button"
              className="take"
              onClick={onClear}
              disabled={busy}
              title="Take your chips back off the felt"
            >
              <TakeBackIcon />
              <span className="take__word">Take back</span>
            </button>
          </>
        ) : (
          <span className="slots__bet-empty">
            {stake > 0 && lineCount === 0
              ? `${exact(stake)} a line — choose how many`
              : `nothing on yet — ${exact(MIN_STAKE)} a line minimum`}
          </span>
        )}
      </div>

      {/*
        * The button, set into the machine rather than laid on the page.
        *
        * Chunky on purpose: it has a side face you can see, it goes down when
        * pressed and springs back past its own height on release. That is the
        * whole trick — a flat rectangle that changes colour is a link, and
        * this is the thing you hit to make the machine go.
        */}
      <div className="slots__go">
        <button
          type="button"
          className={`spin${busy ? " spin--going" : ""}${freeLeft > 0 ? " spin--free" : ""}`}
          onClick={onPull}
          disabled={!canPull}
        >
          {/*
           * The button says what the press will cost, because that is the
           * question the player is actually asking of it. The screen above
           * carries the count too, but a player mid-run is looking at the
           * thing they are about to hit, not at the top of the machine.
           */}
          <span className="spin__face">
            {busy ? "Spinning" : freeLeft > 0 ? "Free spin" : "Spin"}
          </span>
          {freeLeft > 0 && (
            <span className="spin__left">
              {freeLeft}
              {/* Said in full for anybody not looking at it: a bare numeral on
                  a button reads as nothing on its own. */}
              <span className="spin__said"> free spins left</span>
            </span>
          )}
        </button>

        {/* Beside the handle, not instead of it: this arms the same press. */}
        <button
          type="button"
          className={`auto${auto ? " auto--on" : ""}`}
          aria-pressed={auto}
          title={auto ? "Stop spinning on its own" : "Keep spinning until something pays"}
          onClick={onAuto}
        >
          <RepeatIcon />
          <span className="auto__word">Auto</span>
        </button>
      </div>

      <p className="slots__purse">
        <span>
          {exact(balance)} {forFun ? "play chips" : "chips"}
        </span>
        <span className="slots__cap">Max {exact(cap)} a spin</span>
      </p>
    </div>
  );
}

/**
 * A machine you have to be somebody to play.
 *
 * Chips come from an account, and this one pays in them. Not a refusal — the
 * one step between them and the lever.
 */
function SignInToPlay({ available }: { available: boolean }) {
  return (
    <section className="housing gate slots__gate" aria-labelledby="slots-gate-title">
      <div className="housing__body">
        <h2 className="gate__title" id="slots-gate-title">
          This one plays for chips
        </h2>
        <p className="gate__note">
          The bank is real chips other people staked, so there is one step before you pull the
          lever. Sign in and you will land back here.
        </p>
        {available ? (
          <a className="slab slab--wide slab--discord" href="/auth/discord?to=%2Fslots">
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
