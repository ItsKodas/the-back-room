import type { SeatView, TableView } from "@backroom/game-poker";
import { vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";

export const seat = (over: Partial<SeatView> & { id: string; name: string }): SeatView => ({
  connected: true,
  waiting: false,
  avatar: null,
  accentColor: null,
  stack: 2_000,
  committed: 0,
  folded: false,
  allIn: false,
  hole: [],
  showed: null,
  isBot: false,
  spoke: null,
  ...over,
});

export const view = (over: Partial<TableView> = {}): TableView => ({
  you: null,
  code: "ABCDE",
  street: "preflop",
  board: [],
  pot: 30,
  toAct: null,
  turnEndsAt: null,
  turnMs: 30_000,
  button: null,
  smallBlindId: null,
  bigBlindId: null,
  smallBlind: 10,
  bigBlind: 20,
  paid: [],
  paidAt: null,
  swept: [],
  sweptAt: null,
  lastEvent: null,
  eventSeq: 0,
  watching: 0,
  seats: [],
  forFun: false,
  entry: 2_000,
  canShow: false,
  canTakeOff: false,
  hostId: null,
  ...over,
});

/** A socket that records what it was asked to send and does nothing else. */
export function stub(): TableSocketHook<TableView> & { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    state: null,
    listed: true,
    seatId: null,
    error: null,
    errorKey: 0,
    connected: true,
    taken: null,
    retry: vi.fn(),
    busy: false,
    chat: [],
    say: vi.fn(),
    addBot: vi.fn(),
    setListed: vi.fn(),
    create: vi.fn(),
    join: vi.fn(),
    watch: vi.fn(),
    leave: vi.fn(),
    act: (action: Record<string, unknown>) => {
      sent.push(action);
    },
    onRelay: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    landed: [],
    stakes: [],
    taunt: vi.fn(),
  };
}
