import { z } from "zod";
import { CODE_ALPHABET, CODE_LENGTH } from "./protocol.js";

/**
 * Every inbound socket payload, validated before it reaches a handler.
 *
 * The server is the only thing that runs these — the client imports the types
 * beside them and never the schemas, so zod stays out of the browser bundle.
 * Anything that fails here is answered with a message rather than a stack
 * trace, and a malformed payload can never reach the game state.
 */

const name = z.string().trim().min(1).max(20);

const code = z
  .string()
  .trim()
  .toUpperCase()
  .length(CODE_LENGTH)
  .refine((value) => [...value].every((letter) => CODE_ALPHABET.includes(letter)), {
    message: "not a table code",
  });

export const createSchema = z.object({
  name,
  /** Which game. Absent means Greed, so links made before there were two still work. */
  game: z.string().max(24).optional(),
  ruleset: z.string().max(40).optional(),
  /** Absent means listed: a table nobody can find is one you have to arrange. */
  listed: z.boolean().optional(),
  /** A table played for play money, which anybody may sit at. */
  forFun: z.boolean().optional(),
  /**
   * How many seats the host wants at it.
   *
   * Bounded here as well as clamped on the way in: this is the only number in
   * the payload a client picks freely, and a table with a thousand seats is a
   * table nobody can render. Absent means as many as the game allows.
   */
  maxSeats: z.number().int().min(2).max(10).optional(),
  /**
   * What the host wants it to cost to sit down.
   *
   * Bounded here and snapped to a real level by the game, which is the part
   * that matters: this is the number deciding how much of somebody's balance
   * is at risk at a table they sat down at, so a client naming its own would
   * be a client setting the stakes for other people.
   */
  buyIn: z.number().int().min(1).max(1_000_000).optional(),
  /**
   * How long the table takes bets for, in milliseconds.
   *
   * A decision about everybody's evening rather than one player's — a wheel
   * that comes round every fifteen seconds and one that comes round every
   * minute are different games to sit at — so it belongs to the host, with the
   * rest of the table's shape. Bounded here and snapped to a level the game
   * offers, the same way the buy-in is.
   *
   * Not the `window` in the handshake below, which is a browser window's own
   * id. Same word, unrelated things: this one is a length of time.
   */
  window: z.number().int().min(1_000).max(300_000).optional(),
  /**
   * Where a duel at this table starts, for a game that counts down.
   *
   * The same kind of decision as the seat count and the betting window: a
   * table that opens at a hundred is over in four rolls and one that opens at
   * ten thousand takes a while to get going, so it belongs to the host with
   * the rest of the table's shape. Bounded here and snapped to a level the
   * game offers, which is where the real refusal lives.
   */
  ceiling: z.number().int().min(100).max(10_000).optional(),
});

export const setListedSchema = z.object({ listed: z.boolean() });

export const joinSchema = z.object({ name, code });

/** Watching needs no name — a watcher is nobody at the table. */
export const watchSchema = z.object({ code });

export const resumeSchema = z.object({
  seatId: z.string().min(1).max(64),
  code,
});

export const toggleSchema = z.object({
  index: z.number().int().min(0).max(5),
});

export const addBotSchema = z.object({
  skill: z.enum(["easy", "normal", "hard"]),
});

export const removeSeatSchema = z.object({
  seatId: z.string().min(1).max(64),
});

export const chatSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

/**
 * Throwing an emote at somebody.
 *
 * Both ids are bounded strings and nothing more. What an emote costs is not in
 * here on purpose: a price the client sends is a price the client chooses, and
 * this one debits an account. The server reads the cost off the emote.
 */
export const tauntSchema = z.object({
  /** A UUID as minted by the store, but only ever compared, never parsed. */
  emoteId: z.string().min(1).max(64),
  seatId: z.string().min(1).max(64),
});

/** Only the fields a host is allowed to move, and only within sane bounds. */
export const setRulesSchema = z.object({
  targetScore: z.number().int().min(1000).max(100_000).optional(),
  entryThreshold: z.number().int().min(0).max(5000).optional(),
  finalRound: z.boolean().optional(),
  turnTimerSeconds: z.number().int().min(15).max(600).nullable().optional(),
  straight: z.number().int().min(0).max(10_000).nullable().optional(),
  threePairs: z.number().int().min(0).max(10_000).nullable().optional(),
  twoTriplets: z.number().int().min(0).max(10_000).nullable().optional(),
  fourPlusPair: z.number().int().min(0).max(10_000).nullable().optional(),
});

export type CreatePayload = z.infer<typeof createSchema>;
export type JoinPayload = z.infer<typeof joinSchema>;
export type WatchPayload = z.infer<typeof watchSchema>;
export type ResumePayload = z.infer<typeof resumeSchema>;
export type SetRulesPayload = z.infer<typeof setRulesSchema>;

export const setBuyInSchema = z.object({
  amount: z.number().int().min(0).max(1_000_000),
});

/** Minting a code. Bounded so a slip of the keyboard cannot mint a fortune. */
export const mintCodeSchema = z.object({
  chips: z.number().int().min(1).max(1_000_000),
  /** Null or absent means as many people as turn up, each once. */
  maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
  /** Epoch ms. Absent means it does not expire. */
  expiresAt: z.number().int().positive().nullable().optional(),
  note: z.string().max(120).optional(),
});

export type MintCodePayload = z.infer<typeof mintCodeSchema>;

/**
 * One action at a table.
 *
 * Only the type is checked here. What else the payload carries is the game's
 * to validate, because only the game knows what "double" needs — and a schema
 * in the middle that had to know would be a third place the rules live.
 */
export const actionSchema = z
  .object({ type: z.string().min(1).max(24) })
  .catchall(z.unknown());

export type ActionPayload = z.infer<typeof actionSchema>;

/**
 * One pull of the lever.
 *
 * The upper bound is the house's, not the machine's: what a bank can actually
 * cover is decided by the stake cap at spin time, and this only stops a
 * nonsense number reaching that arithmetic at all.
 */
export const spinSchema = z.object({
  stake: z.number().int().min(1).max(1_000_000),
  /**
   * How many paylines were bought. Absent means all nine, which is what the
   * machine did before anybody could choose — so an old client still plays.
   */
  lines: z.number().int().min(1).max(9).optional(),
  /** Play money. Absent means chips, so nothing plays for free by accident. */
  forFun: z.boolean().optional(),
});

export type SpinPayload = z.infer<typeof spinSchema>;

/**
 * What a window says about itself as it connects.
 *
 * Both optional, and a socket that sends neither is let through: every client
 * that predates this rule is one of those, and a handshake is not the place to
 * start refusing people. The window id is the client's own and is trusted only
 * to tell a refresh from a rival — never as an identity.
 */
export const handshakeSchema = z.object({
  game: z.string().max(24).optional(),
  window: z.string().min(1).max(64).optional(),
});

export type HandshakePayload = z.infer<typeof handshakeSchema>;

/**
 * A tap, and the token it must carry.
 *
 * The token is the whole payload because nothing else about a tap is the
 * client's to decide. What it pays comes off the server's jar; a client that
 * could name an amount would be a client naming its own wages.
 */
export const tapSchema = z.object({
  token: z.string().min(1).max(64),
});

export const buySchema = z.object({
  /** Compared against the ladder, never parsed. */
  upgrade: z.string().min(1).max(24),
  token: z.string().min(1).max(64),
});

export type TapPayload = z.infer<typeof tapSchema>;
export type BuyPayload = z.infer<typeof buySchema>;
