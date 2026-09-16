import type { Card, Rank, Suit, TableView } from "@backroom/game-blackjack";
import type { HandView, SeatView } from "./hands.js";

/*
 * Tables as the server describes them, for tests. Whole views rather than
 * casts, so a field the felt starts reading is a field these have to grow.
 */

export function card(rank: Rank, suit: Suit = "spades"): Card {
  return { rank, suit };
}

export function hand(over: Partial<HandView> = {}): HandView {
  return {
    bet: 0,
    cards: [],
    total: 0,
    soft: false,
    bust: false,
    done: false,
    outcome: null,
    returned: 0,
    fromSplit: false,
    ...over,
  };
}

export function seat(id: string, name: string, over: Partial<SeatView> = {}): SeatView {
  return {
    id,
    name,
    ready: false,
    connected: true,
    waiting: false,
    isBot: false,
    signedIn: true,
    avatar: null,
    accentColor: null,
    hands: [hand()],
    active: 0,
    bet: 0,
    purse: 0,
    ...over,
  };
}

/** Ada (seat "a", the host) and Bo, betting at a table for chips. */
export function view(over: Partial<TableView> = {}): TableView {
  return {
    code: "HG4ME",
    status: "lobby",
    phase: "betting",
    seats: [seat("a", "Ada"), seat("b", "Bo")],
    turnSeatId: null,
    turnEndsAt: null,
    turnMs: 20_000,
    hostId: "a",
    watching: 0,
    lastEvent: null,
    eventSeq: 0,
    dealer: { cards: [], total: 0, hidden: false },
    minBet: 100,
    maxBet: 10_000,
    forFun: false,
    bettingMs: 30_000,
    maxSeats: 6,
    waitingForPlayers: false,
    deadline: null,
    ...over,
  };
}

/** Ada to act on nine and seven against a dealer's ten, Bo stood on nineteen. */
export function yourTurn(ada: Partial<SeatView> = {}): TableView {
  return view({
    status: "playing",
    phase: "playing",
    turnSeatId: "a",
    turnEndsAt: Date.now() + 12_000,
    dealer: { cards: [card("10")], total: 10, hidden: true },
    seats: [
      seat("a", "Ada", {
        bet: 500,
        hands: [hand({ bet: 500, cards: [card("9", "hearts"), card("7", "clubs")], total: 16 })],
        ...ada,
      }),
      seat("b", "Bo", {
        bet: 250,
        hands: [hand({ bet: 250, cards: [card("10", "diamonds"), card("9")], total: 19, done: true })],
      }),
    ],
  });
}

/** Ada dealt a pair of eights, with the decision still to make. */
export function pairTurn(): TableView {
  return yourTurn({ hands: [hand({ bet: 500, cards: [card("8"), card("8", "hearts")], total: 16 })] });
}

/** Ada split eights: the first hand stood on eighteen, the second is being played. */
export function splitTurn(): TableView {
  return yourTurn({
    bet: 1_000,
    active: 1,
    hands: [
      hand({ bet: 500, cards: [card("8"), card("K", "diamonds")], total: 18, done: true, fromSplit: true }),
      hand({ bet: 500, cards: [card("8", "hearts"), card("3", "clubs"), card("9")], total: 20, fromSplit: true }),
    ],
  });
}

/** Bo to act on fourteen; Ada stood on nineteen. */
export function theirTurn(): TableView {
  return view({
    status: "playing",
    phase: "playing",
    turnSeatId: "b",
    turnEndsAt: Date.now() + 9_000,
    dealer: { cards: [card("10")], total: 10, hidden: true },
    seats: [
      seat("a", "Ada", {
        bet: 500,
        hands: [
          hand({
            bet: 500,
            cards: [card("9", "hearts"), card("7", "clubs"), card("3", "diamonds")],
            total: 19,
            done: true,
          }),
        ],
      }),
      seat("b", "Bo", {
        bet: 1_000,
        hands: [hand({ bet: 1_000, cards: [card("8", "clubs"), card("6", "hearts")], total: 14 })],
      }),
    ],
  });
}

/** The dealer made nineteen: Ada's blackjack paid, Bo bust. */
export function settledHand(): TableView {
  return view({
    status: "over",
    phase: "settled",
    deadline: Date.now() + 6_000,
    dealer: { cards: [card("10"), card("9", "clubs")], total: 19, hidden: false },
    seats: [
      seat("a", "Ada", {
        bet: 500,
        hands: [
          hand({
            bet: 500,
            cards: [card("A"), card("K", "hearts")],
            total: 21,
            soft: true,
            done: true,
            outcome: "blackjack",
            returned: 1_250,
          }),
        ],
      }),
      seat("b", "Bo", {
        bet: 1_000,
        hands: [
          hand({
            bet: 1_000,
            cards: [card("8", "clubs"), card("6", "hearts"), card("9", "diamonds")],
            total: 23,
            bust: true,
            done: true,
            outcome: "bust",
          }),
        ],
      }),
    ],
  });
}
