/**
 * What every table has in common, whatever is being played at it.
 *
 * Nothing in here knows about dice, cards or reels. A game brings its own
 * rules and its own state and borrows the rest: who is sitting down, who is
 * host, who dropped out, who is only watching.
 */
export {
  MAX_NAME,
  MAX_SEATS,
  MIN_SEATS,
  MIN_TABLE_SEATS,
  seatLimit,
  TableError,
} from "./types.js";
export type { BotSkill, Seat, SeatIdentity, TableStatus } from "./types.js";
export { Seating } from "./seating.js";
export { Catalogue } from "./catalogue.js";
export type { GameListing } from "./catalogue.js";
export type {
  ActResult,
  BotMove,
  ChatRoute,
  Clock,
  FinishedGame,
  GameAdapter,
  GameDeps,
  PlayTable,
  StatBumpLike,
} from "./game.js";
export { COMING } from "./coming.js";
export { BankLedger, ledgerOf } from "./ledger.js";
export { Escrow } from "./escrow.js";
export type { Stake } from "./escrow.js";
export { Taunts } from "./taunts.js";
export type { Resolution, Taunt, TauntPayout } from "./taunts.js";
