import type {
  ChatMessage,
  ClientToServer,
  HouseRules,
  RoomView,
  ServerToClient,
  TableClosed,
  TauntAck,
  TauntPlay,
  TauntStake,
} from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { rejoinOnReturn } from "../net/wake.js";
import { windowId } from "../net/windowId.js";
import type { PendingRoll } from "./useRollAnimation.js";

/** A pending throw, plus the counter it was asked from so we know when it lands. */
interface PendingRollState extends PendingRoll {
  fromSeq: number;
}

/**
 * Same origin, always. Vite proxies the socket to the game server in
 * development, so the session cookie travels with the handshake and the
 * server knows who is sitting down.
 */
const SERVER_URL = "";

type GameSocket = Socket<ServerToClient, ClientToServer>;

/*
 * Keyed by game, not by the building. One key across every game would mean
 * walking from a Greed table to the blackjack page and being quietly put back
 * in the Greed room, whose state this page then discards — a table that looks
 * empty while you are sitting at one.
 */
const SEAT_KEY = "backroom.seat.greed";

interface StoredSeat {
  code: string;
  seatId: string;
}

/** localStorage can throw outright in a private window; never let it break the page. */
function readSeat(): StoredSeat | null {
  try {
    const raw = window.localStorage.getItem(SEAT_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredSeat).code === "string" &&
      typeof (parsed as StoredSeat).seatId === "string"
    ) {
      return parsed as StoredSeat;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeSeat(seat: StoredSeat | null): void {
  try {
    if (seat === null) {
      window.localStorage.removeItem(SEAT_KEY);
    } else {
      window.localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    }
  } catch {
    // ignore
  }
}

export interface RoomActions {
  create: (name: string, ruleset: string, maxSeats?: number) => void;
  join: (name: string, code: string) => void;
  /** Watch a table without taking a seat at it. */
  watch: (code: string) => void;
  addBot: (skill: "easy" | "normal" | "hard") => void;
  removeSeat: (seatId: string) => void;
  start: () => void;
  /** Deals another game at the same table, with the same people. */
  playAgain: () => void;
  /** Takes how many dice go up, so the tumble can start before the reply. */
  roll: (count: number) => void;
  toggle: (index: number) => void;
  bank: () => void;
  say: (text: string) => void;
  setRules: (changes: Partial<HouseRules>) => void;
  setBuyIn: (amount: number) => void;
  /** Whether the table shows up on the public list. The host's call. */
  setListed: (listed: boolean) => void;
  /** Throws a paid-for emote at somebody else at this table. */
  taunt: (emoteId: string, seatId: string, done?: (result: TauntAck) => void) => void;
  leave: () => void;
}

export interface RoomHook {
  room: RoomView | null;
  /** Whether this table shows up on the public list. */
  listed: boolean;
  /**
   * Which dice this player has picked up, when that is ahead of the server.
   * Null once the server has caught up and its own answer should be shown.
   */
  heldLocally: boolean[] | null;
  /** A throw asked for whose dice have not arrived, or null when none is. */
  pendingRoll: PendingRoll | null;
  chat: ChatMessage[];
  seatId: string | null;
  error: string | null;
  connected: boolean;
  /**
   * The server's reason for turning this window away, or null.
   *
   * Held apart from `connected` on purpose: a lost connection and a refused
   * one look nothing alike to a player. One says wait, the other says go and
   * close a tab.
   */
  taken: string | null;
  /** Asks again. socket.io will not retry a refusal from the middleware. */
  retry: () => void;
  busy: boolean;
  /** Taunts thrown at this table, oldest first, for whatever is animating them. */
  landed: TauntPlay[];
  /** What is riding on each seat, from the taunts thrown at them. */
  stakes: TauntStake[];
  actions: RoomActions;
}

/**
 * @param onChips Called when the server says this account's balance has moved.
 * Held in a ref rather than watched, so a caller that rebuilds the callback
 * each render does not tear the socket down and reconnect on every one.
 */
export function useRoom(onChips?: (chips: number) => void): RoomHook {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const socketRef = useRef<GameSocket | null>(null);
  const chipsRef = useRef(onChips);
  chipsRef.current = onChips;
  // Which table this window is actually sitting at, so a close meant for
  // somebody else's table cannot be mistaken for this one's.
  const codeRef = useRef<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [landed, setLanded] = useState<TauntPlay[]>([]);
  const [stakes, setStakes] = useState<TauntStake[]>([]);
  /** Whether the table is on the public list. Not part of the game's view. */
  const [listed, setListedHere] = useState(true);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /**
   * The server's reason for turning this window away, or null. Apart from
   * `connected` on purpose: one says wait, the other says go and close a tab.
   */
  const [taken, setTaken] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  /*
   * What this player has clicked but the server has not answered for yet.
   *
   * Every reply arrives a full round trip after the click that caused it, so a
   * table that waits for one before moving a die feels broken over any real
   * distance. The dice move at once and the server confirms behind them.
   *
   * `pendingToggles` is what makes that safe. While any click is unanswered,
   * incoming state is a picture of the past — adopting it would undo clicks
   * the player has already made and seen. So the local picture stands until
   * the count reaches zero, at which point the server has seen everything and
   * its answer is the better one.
   */
  const [heldLocally, setHeldLocally] = useState<boolean[] | null>(null);
  const pendingToggles = useRef(0);
  /*
   * A throw asked for and not yet answered.
   *
   * Held against the roll counter it was asked from, not as a bare flag. The
   * table broadcasts for all sorts of reasons — a clock tick, someone typing —
   * and an earlier version cleared this on any of them, which cut the dice off
   * mid-air. Only the counter moving means the throw was actually answered.
   */
  const [pendingRoll, setPendingRoll] = useState<PendingRollState | null>(null);
  /* Read by callbacks that must not be rebuilt on every state broadcast. */
  const roomRef = useRef<RoomView | null>(null);
  roomRef.current = room;

  useEffect(() => {
    // No `transports` list on purpose. Naming one makes it the only one tried:
    // tryAllTransports defaults to false, so a websocket-first client that
    // cannot open a websocket gives up rather than falling back, and plenty of
    // proxies do not pass an upgrade through. Socket.IO's own default opens on
    // polling and upgrades when it can, which degrades instead of failing.
    const socket: GameSocket = io(SERVER_URL, {
      withCredentials: true,
      // One window per game per account, and the server needs both to say so.
      auth: { game: "greed", window: windowId() },
    });
    socketRef.current = socket;
    const stopRejoining = rejoinOnReturn(socket);

    socket.on("connect", () => {
      setTaken(null);
      setConnected(true);
      // Reclaim the seat this browser was sitting in, if it is still being held.
      const stored = readSeat();
      if (stored === null) {
        return;
      }
      socket.emit("lobby:resume", stored, (result) => {
        if (result.ok) {
          setSeatId(result.seatId);
        } else {
          writeSeat(null);
        }
      });
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
      } else {
        setError("Cannot reach the server. Is it running?");
      }
    });
    socket.on("room:state", (raw) => {
      /*
       * One channel now carries every game's state, so what arrives is checked
       * before it is believed. A stale socket from another table would
       * otherwise be rendered through these components, which know only dice.
       */
      if (raw.game !== "greed") {
        return;
      }
      // Whether the table is on the public list is the room's fact about it
      // rather than part of the game's view, so it is unpacked separately.
      setListedHere(raw.listed);
      // Absent from a server older than taunts, which is nothing riding on
      // anybody rather than a reason to render nothing.
      setStakes(raw.taunts ?? []);
      codeRef.current = (raw as { code?: string }).code ?? null;
      const state = raw as unknown as RoomView;
      setRoom(state);
      setPendingRoll((waiting) => {
        if (waiting === null) {
          return null;
        }
        // Answered only when the throw counter has actually moved on, or when
        // the turn has ended under us and there is nothing left to wait for.
        const seq = state.turn?.rollSeq ?? 0;
        return seq !== waiting.fromSeq || state.turn === null ? null : waiting;
      });
      if (pendingToggles.current === 0) {
        setHeldLocally(null);
      }
    });
    socket.on("room:error", (message) => {
      setError(message);
      // A refused throw is never answered, so the dice would hang in the air.
      setPendingRoll(null);
    });
    /*
     * The table was called off. Everything that was on it has already gone
     * back to the account, and the balance arrives on its own through
     * me:chips — so all that is left is to stop showing a felt that no longer
     * exists. No lobby:leave: there is nothing left to leave.
     */
    socket.on("room:closed", (closed: TableClosed) => {
      if (closed.code !== codeRef.current) {
        return;
      }
      codeRef.current = null;
      writeSeat(null);
      setRoom(null);
      setSeatId(null);
      setChat([]);
      setError("That table closed. Anything you had on it went back to your chips.");
      navigateRef.current("/greed");
    });
    socket.on("me:chips", (chips) => chipsRef.current?.(chips));
    // Kept client-side rather than in room state: the table broadcasts on
    // every roll, and shipping the backlog each time would be waste.
    socket.on("chat:message", (message) => {
      setChat((log) => [...log.slice(-60), message]);
    });
    // Capped like the chat, and shorter: nothing looks further back than the
    // handful still on screen.
    socket.on("taunt:play", (one) => {
      setLanded((log) => [...log, one].slice(-12));
    });

    return () => {
      stopRejoining();
      socket.close();
      socketRef.current = null;
    };
  }, []);

  // Errors clear themselves so the strip does not accumulate stale complaints.
  useEffect(() => {
    if (error === null) {
      return;
    }
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const create = useCallback((name: string, ruleset: string, maxSeats?: number) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setBusy(true);
    socket.emit("lobby:create", { name, ruleset, maxSeats }, (result) => {
      setBusy(false);
      if (result.ok) {
        setSeatId(result.seatId);
        writeSeat({ code: result.code, seatId: result.seatId });
      } else {
        setError(result.error);
      }
    });
  }, []);

  const join = useCallback((name: string, code: string) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setBusy(true);
    socket.emit("lobby:join", { name, code }, (result) => {
      setBusy(false);
      if (result.ok) {
        setSeatId(result.seatId);
        writeSeat({ code: result.code, seatId: result.seatId });
      } else {
        setError(result.error);
      }
    });
  }, []);

  const watch = useCallback((code: string) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setBusy(true);
    socket.emit("lobby:watch", { code }, (result) => {
      setBusy(false);
      if (result.ok) {
        // No seat, so nothing to store and nothing to reclaim on a refresh.
        writeSeat(null);
        setSeatId(null);
      } else {
        setError(result.error);
      }
    });
  }, []);

  const addBot = useCallback(
    (skill: "easy" | "normal" | "hard") => socketRef.current?.emit("lobby:addBot", { skill }),
    [],
  );
  const removeSeat = useCallback(
    (seatId: string) => socketRef.current?.emit("lobby:removeSeat", { seatId }),
    [],
  );
  const say = useCallback((text: string) => {
    if (text.trim().length > 0) {
      socketRef.current?.emit("chat:send", { text });
    }
  }, []);
  const taunt = useCallback(
    (emoteId: string, at: string, done?: (result: TauntAck) => void) => {
      socketRef.current?.emit("taunt:send", { emoteId, seatId: at }, (result: TauntAck) => {
        // Somebody just spent chips, or thought they had; a refusal is worth
        // saying out loud rather than swallowing.
        if (!result.ok) {
          setError(result.error);
        }
        done?.(result);
      });
    },
    [],
  );
  const setRules = useCallback(
    (changes: Partial<HouseRules>) => socketRef.current?.emit("lobby:setRules", changes),
    [],
  );
  const setBuyIn = useCallback(
    (amount: number) => socketRef.current?.emit("lobby:setBuyIn", { amount }),
    [],
  );
  const setListed = useCallback(
    (listed: boolean) => socketRef.current?.emit("lobby:setListed", { listed }),
    [],
  );
  const start = useCallback(() => socketRef.current?.emit("game:action", { type: "start" }), []);

  const playAgain = useCallback(() => {
    setHeldLocally(null);
    setPendingRoll(null);
    socketRef.current?.emit("game:action", { type: "playAgain" });
  }, []);

  /**
   * @param count How many dice are going up. The caller works this out from
   * the rules, because the dice themselves are a round trip away and the
   * animation cannot wait for them without being the thing it is fixing.
   */
  const roll = useCallback((count: number) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setPendingRoll({ count, fromSeq: roomRef.current?.turn?.rollSeq ?? 0 });
    setHeldLocally(null);
    socket.emit("game:action", { type: "roll" });
  }, []);

  const bank = useCallback(() => socketRef.current?.emit("game:action", { type: "bank" }), []);

  const toggle = useCallback((index: number) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setHeldLocally((current) => {
      const base = current ?? roomRef.current?.turn?.held ?? null;
      if (base === null) {
        return current;
      }
      const next = [...base];
      next[index] = next[index] !== true;
      return next;
    });
    pendingToggles.current += 1;
    socket.emit("game:action", { type: "toggle", index }, () => {
      pendingToggles.current -= 1;
      if (pendingToggles.current === 0) {
        // The server has now seen every click; its picture is the true one.
        setHeldLocally(null);
      }
    });
  }, []);

  const retry = useCallback(() => {
    setTaken(null);
    socketRef.current?.connect();
  }, []);

  const leave = useCallback(() => {
    writeSeat(null);
    socketRef.current?.emit("lobby:leave");
    setRoom(null);
    setSeatId(null);
    setChat([]);
    // Clearing the address too, so leaving does not drop the player back on
    // the table's own URL — which reads as an invitation to rejoin it. Back to
    // the game rather than the room: you left a table, not the building.
    navigate("/greed");
  }, [navigate]);

  return {
    room,
    listed,
    landed,
    stakes,
    heldLocally,
    pendingRoll,
    chat,
    seatId,
    error,
    connected,
    taken,
    retry,
    busy,
    actions: {
      create,
      join,
      watch,
      addBot,
      removeSeat,
      setRules,
      setBuyIn,
      setListed,
      say,
      taunt,
      start,
      playAgain,
      roll,
      toggle,
      bank,
      leave,
    },
  };
}
