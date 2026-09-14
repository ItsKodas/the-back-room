# Calling off a table: `void`, escrow and `room:closed`

## Problem

There is no path that returns chips in play when a table goes away.

- `reapWhenEmpty` (`apps/server/src/server.ts`) deletes a room once every seat
  is a bot or disconnected. It drops timer handles without clearing them,
  leaves `settled` behind, burns taunt pools with `taunts.forget`, and refunds
  nothing that is committed at the table.
- `close()` refunds nothing either.
- `BankLedger` has no release. A deleted table whose `owed()` is still positive
  keeps its reservation against the bank forever.
- `GameAdapter` has no way to call off a hand. Clients get no event when a
  table closes.

Worse, by the time a table is reaped several games have already lost the
chips, because a seat removed after the reconnect grace takes its stake with
it:

- roulette and two-up casino filter a leaving seat's chips off the cloth while
  they sit in the bank;
- blackjack splices out a seat that leaves during betting with its bet already
  in the bank;
- greed keeps no per-seat record of who paid, so a player who left during the
  `start` take loop is never refunded.

And stakes can be out of an account without being on the table: roulette and
two-up casino `place`/`repeat`, poker `buyIn`, and blackjack between `take` and
`bank.add` all await before the chips land, and a throw in that window strands
them.

This breaks "waiting never costs anybody a stake" and, for banked games, lets
a bank quietly keep chips players never lost.

## Decisions

1. **Scope:** `void`, plus the leave losses and take-before-land gaps above.
   Out of scope: blackjack dealing a stake whose take is later refused; greed's
   `pot` counting unpaid waiting seats; slots (a spin is one call inside
   `serially`) and tips (no stakes).
2. **Leave rule:** while betting is open, leaving returns the seat's stakes.
   Once betting closes, stakes ride to the result and settle to the account
   they came from, seated or not.
3. **Void never rewrites an outcome:** a round that is already decided is
   settled normally (taunts resolve too); only a round with no result is called
   off and refunded.
4. **Approach:** a per-table escrow written at take time, which `void` refunds
   from. Not reading table fields (cannot see in-flight stakes or departed
   accounts), not server-side refunds (the server would reach games' banks).

## Revisions made while planning

Found while mapping every game's money paths; these override the sections
below where they disagree.

- `Stake` is `{ userId, chips }`. Whether a refund goes through a bank is a
  property of the table (the adapter's `banked(table)`), never of one stake.
- `refund(userId, chips?)` takes an optional amount. Poker needs it: a leaver's
  stack goes back while what they already bet stays in the pot.
- Escrow exposes `get due(): readonly Stake[]` so tables' tests can read the
  queue without draining it.
- Where the table itself lands chips (`place`, `buyIn`, `setCentre`, `cover`),
  the **table** holds them, so recording a stake and landing it are one
  synchronous step. If `hold` refuses, the table throws
  `TableError("This table is closing.")` and the adapter's existing
  refund-on-throw path returns the chips.
- A round is marked decided (`escrow.settle()`) at the table's own decision
  point — greed `finish`, blackjack reaching `settled`, roulette `land`, two-up
  `read`, poker `award` — rather than in the adapter's `settle`. A decided round
  that somehow never settled then loses its stakes instead of refunding chips
  that were already lost. Death roll has no synchronous decision point on the
  table, so it drains in `settle` and again in `finish` as a backstop.
- No separate `table.voided` flag. The server stops every timer and broadcast
  for a closing table, and `escrow.closed` is what refuses an in-flight stake.
- A banked adapter's `owing(table)` returns 0 once `escrow.closed`, so an act
  queued behind a void cannot put the reservation back through `serially`'s
  `finally`.

## Core (`packages/core`)

### `Escrow` — `src/escrow.ts`

Each chips table owns `readonly escrow`. It is the round's record of chips that
left an account and have neither come back nor been decided.

```ts
interface Stake { userId: string; chips: number; banked: boolean }

class Escrow {
  hold(userId: string, chips: number, banked: boolean): boolean;
  release(userId: string, chips: number): void;
  refund(userId: string): void;
  takeDue(): Stake[];
  heldBy(userId: string): number;
  get total(): number;
  settle(): Stake[];
  close(): Stake[];
  get closed(): boolean;
}
```

- `hold` records chips that have just been taken. Returns `false` once closed;
  the caller then gives back what it took.
- `release` removes chips that went back by an ordinary route (a lowered bet,
  a take-back, a refund-on-throw).
- `refund` moves everything an account holds onto the due queue; `takeDue`
  empties the queue. Needed because `removeSeat` is synchronous and has no
  deps, so a leave can only queue its refund. Every game's `payOut` drains it.
- `settle` empties the held stakes when a round is decided: those chips now
  belong to the result.
- `close` empties held stakes *and* the due queue, returns all of it, and makes
  every later `hold` refuse.
- Keyed by account, so a departed seat stays payable. Guests and play money
  never write to it.
- Nothing on it is asynchronous, so a game can empty it before its first await —
  the same exactly-once discipline `payOut` relies on.

**In-flight rule.** Every take-then-land path is one unit (inside the bank's
`serially` for banked games): `deps.take` → `escrow.hold` → `bank.add` → land
on the table. If `hold` refuses, give back at once. If the table is voided
after `hold`, `void` has refunded the stake from escrow; landing then refuses
with "This table is closing." and does not refund again. A banked void runs in
the same `serially` queue, so it cannot interleave with a unit.

### `GameAdapter.void`

```ts
void(table: T, deps: GameDeps): Promise<Refund[]>; // Refund = { userId; chips }
```

Required, so a new game cannot omit it. Each implementation:

1. `escrow.close()` synchronously, and sets the table's own `voided` state so
   clock-driven phases stop moving.
2. For each stake: banked → `bank.take(chips)` then `deps.give`; unbanked →
   `deps.give`. Banked work runs in `ledger.serially`.
3. `ledger.release(table)` for banked tables.
4. Returns what it refunded.

A refused `bank.take` during void is an accounting bug (escrowed stakes are
inside the ledger's reservation). It is logged with amounts, as `pay()` does,
and never paid from nowhere.

### `BankLedger.release(table)`

Deletes the table's promise from the book.

### `Taunts.refund(code): Taunt[]`

Takes and returns a table's pool; the server gives each `chips` back to
`fromUserId`. The header note changes: a pool is burned when its target loses,
returned when the table is called off without a result.

## Games

Common to all: `payOut` drains `escrow.takeDue()` before its first await
(banked: `bank.take` then `give`); `settle` calls `escrow.settle()` before its
first await.

- **Greed.** `start` holds each buy-in; a failed start releases and refunds as
  now; after the loop, any held account no longer seated is refunded. Friendly
  (`buyIn` 0) never touches escrow. Void refunds every buy-in.
- **Blackjack.** Bet, double and split each `take → hold → bank.add` in one
  `serially` unit; a lowered bet releases alongside its give. `removeSeat`
  during betting queues the seat's stake (new `payOut`). After the deal the
  seat is held as now. Void mid-hand returns bets, doubles and splits.
- **Roulette, two-up casino.** `place`/`repeat` become one `serially` unit;
  a throw from `table.place` releases and pays back inside it. Take-back, undo
  and clear release. `removeSeat` during betting queues the seat's chips; after
  betting closes it leaves them on the cloth, and an `accounts` map (as two-up's
  ring has) lets `settle` pay a departed account instead of skipping it.
- **Two-up ring.** Centre and cover hold; their refund-on-throw paths release.
- **Poker.** Escrow is *each account's claim on the table's chips*. Buy-in holds
  straight after the take. Leaving queues via `escrow.refund` in place of
  `owedOut`. On award, `escrow.settle()` then each stack is held again. Ghost
  contributions carry a user id. Void mid-hand returns each stack plus that
  account's contribution to the undecided pot, ghosts included.
- **Death roll.** Antes and pass prices hold; existing refund paths release.
  `settle` pays the pot to the winner's account from the duel even if their
  seat is gone. Void mid-duel returns both antes and every pass.

## Server (`apps/server/src/server.ts`)

`closeTable(code, reason)` and `closeAllTables(reason)`, both returned from
`createBackRoomServer`:

1. Add to `closing`. `guard`, join, watch refuse ("This table is closing.").
   `clearTimeout` and delete the code's `turnClocks`, `pauses`, `botMoves`.
   `broadcast` returns early for a closing code.
2. Await any in-flight settle, recorded by `broadcast` in a `settling` map.
3. If `isSettled` and not in `settled`, run `settleNow(code, seated)` — settle
   then `payTaunts`, factored out of `broadcast`.
4. `await game.void(table, deps)` (drains the leave queue too).
5. `taunts.refund(code)`; give each back to its thrower.
6. Emit `room:closed { code, reason }` to the socket.io room; delete every
   `sockets` entry for the code and `socket.leave` it.
7. Delete from `rooms`, `settled`, `settling`, `closing`.

A step that throws is logged with the code and escrow contents and the close
carries on.

- `reapWhenEmpty`'s timer calls `closeTable(code, "empty")`.
- `close()` awaits `closeAllTables("shutdown")` before clearing timers and
  closing `io` and the store.

## Protocol (`packages/shared/src/protocol.ts`)

```ts
"room:closed": (closed: { code: string; reason: "empty" | "shutdown" | "admin" }) => void;
```

## Client

`useTableSocket` and `useRoom` handle `room:closed` when its code is the table
they are at: `writeSeat(null)`, clear state, seat and chat (no `lobby:leave`
emit), show "That table closed. Anything you had on it went back to your
chips." on the existing notice strip, and leave (`onLeave()` /
`navigate("/greed")`). The balance arrives through `me:chips`.

## Tests

Every one is watched failing against a `void` that closes escrow and refunds
nothing (or the pre-change leave behaviour) before the refund goes in.

- **Core:** escrow hold/release/refund/takeDue/settle/close-refuses;
  `BankLedger.release`; `Taunts.refund`.
- **Each game** (existing fake ledger/bank helpers; a new `adapter.test.ts` for
  poker): void mid-round restores accounts and bank exactly; void during a
  pending take (deferred promise) refunds exactly once; leave during betting
  refunds; leave after betting closes is paid at settle; `escrow.total` matches
  the table's committed chips through place/change/remove.
- **Server sockets:** roulette cloth reaped after every seat drops → balance
  restored, bank unchanged, watcher receives `room:closed`; `server.close()`
  refunds a live blackjack bet; a taunt pool returns to its thrower; a reaped
  table no longer reduces another table's cap; no timer fires into a reaped
  room.
- **Client:** `room:closed` clears the stored seat and leaves; a different code
  is ignored.
