import type {
  Ack,
  BotSkill,
  ChatMessage,
  ClientToServer,
  ServerToClient,
  TableClosed,
  TableState,
  TauntAck,
  TauntPlay,
  TauntStake,
} from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { rejoinOnReturn } from "../net/wake.js";
import { windowId } from "../net/windowId.js";

/**
 * Sitting at a table, whatever is played at it.
 *
 * Everything here is true of any game: opening a table, taking a seat at one,
 * watching one, reclaiming a seat after a refresh, and sending a move. What a
 * move means, and what the state that comes back looks like, is the game's.
 */

type TableSocket = Socket<ServerToClient, ClientToServer>;

/**
 * Everything about a new table except who is opening it. Taken from the
 * protocol rather than restated, so a game that gains an option here cannot
 * gain one this hook silently drops.
 */
export type CreateOptions = Omit<Parameters<ClientToServer["lobby:create"]>[0], "name">;



interface StoredSeat {
  code: string;
  seatId: string;
}

/*
 * Keyed by game, not by the building. One key across every game would mean
 * walking from one table to another game's page and being quietly put back in
 * the first room, whose state that page then discards — a table that looks
 * empty while you are sitting at one.
 */
const seatKey = (game: string) => `backroom.seat.${game}`;

function readSeat(game: string): StoredSeat | null {
  try {
    const raw = window.sessionStorage.getItem(seatKey(game));
    return raw === null ? null : (JSON.parse(raw) as StoredSeat);
  } catch {
    return null;
  }
}

function writeSeat(game: string, seat: StoredSeat | null): void {
  try {
    if (seat === null) {
      window.sessionStorage.removeItem(seatKey(game));
    } else {
      window.sessionStorage.setItem(seatKey(game), JSON.stringify(seat));
    }
  } catch {
    // A browser that will not remember is not a reason to refuse to play.
  }
}

export interface TableSocketHook<TView> {
  /** The table as this seat sees it, or null before one is open. */
  state: TView | null;
  /** Whether this table shows up on the public list. */
  listed: boolean;
  seatId: string | null;
  error: string | null;
  /** Moves on for every refusal, so the same words twice are still shown twice. */
  errorKey: number;
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
  /* Table talk belongs to the building rather than to any game: the server
     reads nothing but the text, and every room has people in it. */
  chat: ChatMessage[];
  say: (text: string) => void;
  /** Seats a bot. Refused by the server for a game that has none. */
  addBot: (skill: BotSkill) => void;
  /** Whether the table is on the public list. The host's call. */
  setListed: (listed: boolean) => void;
  create: (name: string, options?: CreateOptions) => void;
  join: (name: string, code: string) => void;
  watch: (code: string) => void;
  leave: () => void;
  /** Sends a move. What is in it is between the caller and the game. */
  act: (action: Record<string, unknown>, done?: () => void) => void;
  /**
   * Taunts thrown at this table, oldest first, for whatever is animating them.
   *
   * A log rather than "the current one": two can land in the same second and
   * the second must not cut the first short. Each carries its own id, so the
   * stage keys on that and each throw is animated exactly once.
   */
  landed: TauntPlay[];
  /** What is riding on each seat, from the taunts thrown at them this hand. */
  stakes: TauntStake[];
  /**
   * Throws a paid-for emote at somebody.
   *
   * The reply carries the sender's balance, so a picker that showed the cost
   * leaving on the press has something truthful to settle to.
   */
  taunt: (emoteId: string, seatId: string, done?: (result: TauntAck) => void) => void;
}

/**
 * @param game Which game's state to accept. One channel carries every game
 * now, and a state from another table rendered through these components would
 * be nonsense at best.
 */
/**
 * @param onChips Called when the server says this account's balance has moved.
 * Held in a ref rather than watched, because a caller that rebuilds the
 * callback each render would otherwise tear the socket down and reconnect on
 * every one of them.
 */
export function useTableSocket<TView>(
  game: string,
  onLeave: () => void,
  onChips?: (chips: number) => void,
): TableSocketHook<TView> {
  const socketRef = useRef<TableSocket | null>(null);
  const chipsRef = useRef(onChips);
  chipsRef.current = onChips;
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);
  // Which table this window is actually sitting at, so a close meant for
  // somebody else's table cannot be mistaken for this one's.
  const codeRef = useRef<string | null>(null);
  const [state, setState] = useState<TView | null>(null);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Counted, not just stored: React will not re-render for a string it already
   * has, so a table saying the same no twice would otherwise say it once.
   */
  const [errorKey, setErrorKey] = useState(0);
  /** The table or the server saying no to something this player did. */
  const refuse = useCallback((message: string) => {
    setError(message);
    setErrorKey((key) => key + 1);
  }, []);
  const [connected, setConnected] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  /** The room's fact about the table rather than part of the game's view. */
  const [listed, setListedHere] = useState(true);
  const [landed, setLanded] = useState<TauntPlay[]>([]);
  const [stakes, setStakes] = useState<TauntStake[]>([]);

  useEffect(() => {
    // No transports named on purpose: naming one makes it the only one tried,
    // and a browser that cannot open a websocket would simply give up.
    const socket: TableSocket = io("", {
      withCredentials: true,
      // Which game this window has open, and which window it is. The server
      // allows one window per game per account and needs both to say so.
      auth: { game, window: windowId() },
    });
    socketRef.current = socket;
    const stopRejoining = rejoinOnReturn(socket);

    socket.on("connect", () => {
      setTaken(null);
      setConnected(true);
      const stored = readSeat(game);
      if (stored === null) {
        return;
      }
      socket.emit("lobby:resume", stored, (result: Ack) => {
        if (result.ok) {
          setSeatId(result.seatId);
        } else {
          writeSeat(game, null);
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
      }
    });
    socket.on("room:state", (raw: TableState) => {
      if (raw.game !== game) {
        return;
      }
      setListedHere(raw.listed);
      // Absent from a server that predates taunts, which is nothing riding on
      // anybody rather than a reason to render nothing at all.
      setStakes(raw.taunts ?? []);
      codeRef.current = (raw as { code?: string }).code ?? null;
      setState(raw as unknown as TView);
    });
    socket.on("room:error", (message: string) => refuse(message));
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
      writeSeat(game, null);
      setState(null);
      setSeatId(null);
      setChat([]);
      setError("That table closed. Anything you had on it went back to your chips.");
      onLeaveRef.current();
    });
    socket.on("me:chips", (chips: number) => chipsRef.current?.(chips));
    // Capped, because a long night at a table should not grow without limit.
    socket.on("chat:message", (message: ChatMessage) =>
      setChat((log) => [...log, message].slice(-60)),
    );
    // Capped for the same reason, and shorter: nothing needs to look further
    // back than the handful still on screen.
    socket.on("taunt:play", (one: TauntPlay) =>
      setLanded((log) => [...log, one].slice(-12)),
    );

    return () => {
      stopRejoining();
      socket.close();
      socketRef.current = null;
    };
  }, [game, refuse]);

  // Complaints clear themselves rather than stacking up. Keyed on the refusal as
  // well as the words, so a second identical refusal gets its full four seconds
  // instead of vanishing on the first one's clock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error === null) {
      return;
    }
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error, errorKey]);

  const create = useCallback((name: string, options: CreateOptions = {}) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setBusy(true);
    socket.emit("lobby:create", { name, ...options }, (result: Ack) => {
      setBusy(false);
      if (result.ok) {
        setSeatId(result.seatId);
        writeSeat(game, { code: result.code, seatId: result.seatId });
      } else {
        refuse(result.error);
      }
    });
  }, [game, refuse]);

  const join = useCallback((name: string, code: string) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setBusy(true);
    socket.emit("lobby:join", { name, code }, (result: Ack) => {
      setBusy(false);
      if (result.ok) {
        setSeatId(result.seatId);
        writeSeat(game, { code: result.code, seatId: result.seatId });
      } else {
        refuse(result.error);
      }
    });
  }, [game, refuse]);

  const watch = useCallback((code: string) => {
    const socket = socketRef.current;
    if (socket === null) {
      return;
    }
    setBusy(true);
    socket.emit("lobby:watch", { code }, (result: Ack) => {
      setBusy(false);
      if (result.ok) {
        // No seat, so nothing to reclaim on a refresh.
        writeSeat(game, null);
        setSeatId(null);
      } else {
        refuse(result.error);
      }
    });
  }, [game, refuse]);

  const leave = useCallback(() => {
    writeSeat(game, null);
    socketRef.current?.emit("lobby:leave");
    setState(null);
    setSeatId(null);
    // Somebody else's table talk is not yours to carry to the next one.
    setChat([]);
    onLeave();
  }, [game, onLeave]);

  const act = useCallback((action: Record<string, unknown>, done?: () => void) => {
    socketRef.current?.emit("game:action", action as { type: string }, done);
  }, []);

  const retry = useCallback(() => {
    setTaken(null);
    socketRef.current?.connect();
  }, []);

  const addBot = useCallback((skill: BotSkill) => {
    socketRef.current?.emit("lobby:addBot", { skill });
  }, []);

  const setListed = useCallback((next: boolean) => {
    socketRef.current?.emit("lobby:setListed", { listed: next });
  }, []);

  const say = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    socketRef.current?.emit("chat:send", { text: trimmed });
  }, []);

  const taunt = useCallback(
    (emoteId: string, at: string, done?: (result: TauntAck) => void) => {
      const socket = socketRef.current;
      if (socket === null) {
        return;
      }
      socket.emit("taunt:send", { emoteId, seatId: at }, (result: TauntAck) => {
        // A refusal is worth saying out loud: somebody just spent chips, or
        // thought they had.
        if (!result.ok) {
          refuse(result.error);
        }
        done?.(result);
      });
    },
    [refuse],
  );

  return {
    state,
    listed,
    seatId,
    error,
    errorKey,
    landed,
    stakes,
    taunt,
    connected,
    taken,
    retry,
    busy,
    chat,
    addBot,
    setListed,
    create,
    join,
    watch,
    leave,
    act,
    say,
  };
}
