# Death Roll at six seats — design

Death roll opened as a duel. This makes it a table: two to six people, one
number, and the last one standing takes every ante on the felt.

It amends `2026-09-10-death-roll-design.md`, and supersedes three things in it:
the "More than two seats" and "A rematch button" lines of its *Deliberately not
in this version* list, and its claim that a pass "turns correct at ceiling 8".
That last one was wrong in a way that matters for the two-seat game already
live, and it is fixed here at every table size — see *The pass* below.

## The game

The host opens a table with a **seat count (2–6)**, a **stake** and an
**opening ceiling**. Everybody dealt in antes, and the game is a run of rounds:

- A round is death roll as it always was. Players take turns in seat order
  rolling `1..ceiling`, and whatever comes up is the next ceiling.
- **Roll a 1 and you are out.** The round ends there.
- The next round starts at **ceiling 100**, whatever the table opened at, with
  everyone still in. Only the first round starts at the host's opening ceiling.
- The next round is opened by the next player still in, counting on from
  whoever just went out.
- The **last player left takes the pot**: every ante, plus every pass paid.

The first round of a game is opened by the next player dealt in after whoever
opened the
previous game, so who takes the underdog's first roll goes round the table
between games rather than landing on the same person every time.

A table of two plays exactly one round — the duel — so a two-seat table is
this game with the rounds already over, and nothing about two seats is a special
case in the code.

### How long a game runs

| Players | Host opens at 1000 | at 100 | at 10,000 |
|---:|---:|---:|---:|
| 2 | ~8 rolls | ~6 | ~11 |
| 3 | ~15 | ~12 | ~17 |
| 6 | ~33 | ~31 | ~35 |

A round from 100 averages 6.2 rolls; from 1000, 8.5. Restarting at 100 is what
keeps a full table near thirty rolls rather than forty.

## The pass

On your turn you may **pay a tenth of the ante into the pot and hand the roll to
the next player at the same ceiling** instead of rolling. Two rules, at every
table size:

1. **One pass each, fresh every round.** A duel still holds at most one pass per
   player, so every round still ends.
2. **You cannot pass a roll that was passed to you.** If it reached you by a
   pass, you roll it.

### Why the second rule exists

Without it the pass is never used by two players who both understand it.

Whatever a first pass is worth to the player who makes it, the player it lands
on gains exactly the same by passing it straight back — so a first pass is
always returned, and the passer has paid to end up where they started. At
ceiling 2 in a duel: you pay, they pay, you roll anyway at 66.7%. Solved
properly for every table size, with everyone holding a pass, **nobody ever
passes first at any ceiling**. The pass as shipped was a button nobody who had
worked it out would press, and the hard bot — which passes at 8 without asking
whether its opponent still holds one — was the one player guaranteed to press
it.

With pass-backs forbidden, a first pass cannot be returned, and it comes back to
life. Solved with the real price, the ceiling at which a player to act who
holds a pass should spend it, when everyone else still holds one too:

| Players | First pass is right at | Highest ceiling any player, in any position, ever passes |
|---:|---:|---:|
| 2 | 3 or below | 3 |
| 3 | 2 or below | 4 |
| 4 | 6 or below | 6 |
| 5 | 3 or below | 7 |
| 6 | 8 or below | 8 |

Odd table sizes pass lower than even ones: turn order decides who a pass
actually lands on, and with an odd number of players the roll comes back round
differently. This is why the bot and the readout come from a solver rather than
a formula.

**One state has no fixed right answer.** At three players, ceiling 3, with all
three still holding a pass, whether each should pass depends on the next
player's choice in a loop with no stable end — the way rock-paper-scissors has
none. The correct play there is to pass 59.2% of the time: the one chance that
leaves nobody better off doing anything else. That is what the solver returns
and what the hard bot does. Every other state, at every table size, has a fixed
best choice, and odds.test.ts proves it.

**Nobody passes above ceiling 8 at any table size.** That fact is what makes
the solver cheap, and it is pinned by a test.

### The model the solver uses

A round is solved as a game in which each player acts to keep themselves in.
The state is the ceiling, whose turn it is, which players still hold a pass, and
whether the roll in hand was passed to them. A player passes when doing so
lowers their own chance of going out this round by more than the pass costs,
where surviving a round with *k* players is worth about the pot shared among the
*k − 1* survivors. With a price of a tenth of the ante that is a margin of
`(k − 1) / (10k)` — 5 points at two players, 8.3 at six.

The two-player closed form, `1/2 + 1/(N(N+1))`, is kept. It is the exact answer
for a round in which nobody holds a pass, which makes it the test oracle for the
solver's no-pass case.

## Dealing: the ready button

A table no longer deals on its own timer the moment two people sit down. It
deals when the people sitting there say they are in.

- Between games, everybody seated has a **ready** control. Pressing it takes no
  chips, and it is not offered while a game is running.
- **When every seated player is ready, and there are at least two, the table
  deals at once.**
- **When at least two are ready but somebody is not, a 20-second countdown
  starts.** When it ends, the table deals the players who are ready. Anybody not
  ready sits that game out. This is what stops one idle player holding the table
  hostage.
- The countdown is not restarted by somebody sitting down — joining and leaving
  cannot be used to hold it off — and it is abandoned if ready drops below two.
- **Ready resets for everybody when a game ends.** Pressing it again is how a
  player says they want the next one.
- **Bots are always ready.** A player alone at a for-fun table with bots presses
  ready and is dealt in immediately.
- Somebody who sits down while a game is running waits for the next one.

### The house rule this bends

CLAUDE.md says a table deals itself: *"Nobody presses start."* Ready is not a
start button — it is each player saying they are in, and the table still deals
itself the moment that is true or the countdown runs out. But it is a gate a
player presses, and the house rule should say so rather than be quietly
contradicted. The proposed amendment, one sentence added after *"players sit
down and leave whenever they like"*:

> A table may ask whoever is sitting down whether they are in, so long as its
> own clock deals anyway once enough of them are — a ready button that one idle
> player can hold shut is a table that has stopped dealing itself.

That amendment is part of this work and is flagged for review with the spec.

## Where the chips are

**Still no bank, and still no argument needed.** The pot is every ante plus
every pass paid, one player takes all of it, and so the winner's gain is exactly
everybody else's loss.

- **Antes go on at the deal and at no other moment.** Pressing ready moves
  nothing.
- At the deal, each ready player antes in seat order.
  - **A refusal** (`take` returns false) means that player cannot cover it:
    they sit this game out, their ready resets, and the felt says why. It does
    not stop anybody else being dealt.
  - **A throw** (the store failed) means nobody is dealt: every ante already
    taken is handed back, and every ready resets.
  - **A player who stood up while the antes were being taken** is handed theirs
    back and is not dealt.
- If fewer than two players end up funded, every ante taken is handed back,
  every ready resets, and the table says it could not deal.
- A failed deal never retries on a timer. Ready resets, and the next attempt
  happens when people press it again — so there is nothing to spin, and the
  ten-second short-retry and the previously-short-seat ordering from the
  duel's review both go away.

**Once dealt:**

- A player who goes out is owed nothing and may leave. Their seat clears when
  the game ends, so turn order and the pot never have to account for a seat
  disappearing mid-game.
- A player still in who leaves keeps their seat, as before, and their turns
  roll on the clock. If they win, they are paid.
- A pass is debited at the press, refunded if the table moved on while the
  chips were in flight — as the duel does today.
- A for-fun table's purses work as before and never touch an account.

### What a game comes to

- Pot = `ante × players dealt + every pass paid`.
- Winner's net = `pot − (ante + their passes)`.
- Everybody else's net = `−(ante + their passes)`.
- The nets sum to zero, always.

Stats keep their existing keys — `duels` counts games and `passes` counts passes
— so nobody's history is lost. `chipsStaked` is the ante plus that seat's
passes, as it is today.

## The turn clock

Thirty seconds, and it still **rolls rather than forfeits**. A roll that was
passed to you is rolled; a roll you could have passed is also rolled — the clock
never spends somebody's pass for them.

After a player goes out there is a **three-second pause** showing who, before
the next round starts at 100. After the last round there is the existing
five-second result pause, then ready resets.

## The odds readout

The number under the ceiling becomes **the chance the player to roll goes out
this round**, if everybody plays well from here. It reads the current state —
ceiling, whose turn, who still holds a pass, whether the roll in hand was passed
— and comes from the same solver the bot uses.

It is computed from the shared `odds.ts` on the client, memoised per table size
and set of pass-holders. It is a display, not a rule, so the client computing it
is within bounds; the server never consults it.

**Computing it cheaply.** The solver works exactly over every pass state up to
ceiling 32. Above that nobody passes, so a round is roll-only and each set of
pass-holders is a single linear recursion up to the ceiling in hand. At six
players and ceiling 10,000 that is a few hundred thousand operations, once.

## The bot

- **Hard** plays the solver's move, which in that one three-player state means
  passing 59.2% of the time.
- **Normal** values surviving a round at less than it is worth, which raises the
  bar a pass has to clear.
- **Easy** never passes.

All three know the new rule and never try to pass a roll passed to them.

## The felt

The layout picked in brainstorming:

- **Desktop — a rail.** Seats listed down the left in turn order, each showing
  its state: ready, holds a pass, passed, out, your roll, must roll. The number
  owns the rest of the felt, centred in it.
- **Phone — a grid.** Seats in two columns above the number, the number centred
  below, the controls along the bottom within thumb reach.
- The rail is used when the felt is at least 640px wide, the grid below that.

**The squish.** The felt currently grows only to fit its content and stacks
from the top, so the seats sit flush under the header. The felt now takes the
height below the header, with the stage centred in it and room between the
header and the seats.

**What the felt says:**

- Out seats are faded and struck through.
- The line under the number spells the move out in words:
  - on your turn, "Your roll — roll it, or pass it to Fay";
  - when it was passed, "Bob's roll — Cat passed it to him, so he must roll".
- When a roll was passed to you, Pass is not there — a courtesy, since the
  server refuses it regardless.
- The pot line reads `Pot 3,100 · round 3 of 5`.

**Before a game:**

- Seats show ready or not ready; open seats are dashed outlines.
- The opening ceiling sits dimmed in the middle.
- The status reads "Dealing in 14s — 3 of 4 ready".
- **I'm ready** sits exactly where Roll sits during play, so the thumb's place
  does not move between games.

**Pressing, on a bad connection.** Ready is the player's own choice, so it shows
at once and is given up if refused. Roll and pass keep the behaviour the duel
already has.

**Motion.** A player going out gets one short motion saying so, and the
countdown ticks. Both have a `prefers-reduced-motion` off switch, and the felt
says everything without them.

**Hosting.** The seat picker comes back, offering 2 to 6, default 6. It was
removed when the table could only ever hold two.

## The protocol

Nothing new on the wire beyond the action payloads, which are the game's to
validate:

- `{ type: "ready", ready: boolean }`
- `{ type: "roll" }` and `{ type: "pass" }`, as today

The view changes:

- `phase` becomes `"waiting" | "playing" | "over"`. `"dueling"` goes, since a
  six-seat game is not a duel.
- Each seat gains `ready`, `out` and `short`.
- The table gains `round`, `rounds`, `passedTo` (the seat a roll was passed to,
  or null), `countdownEndsAt`, `lastOut` (for the three-second pause), and
  `order` (seat ids in turn order, which is what the rail draws).
- `waitingFor` becomes `"players" | null` — `"funds"` goes, since a short player
  no longer stops the table.

`lobby:create` already carries `maxSeats`. The listing's `maxSeats` goes from 2
to 6, and its blurb becomes *"Halve the number or pay. Roll a one and you're
out."*

## Where the code lives

- **`odds.ts`** becomes the round solver. The two-player closed form stays as
  the no-pass oracle.
- **`duel.ts` becomes `round.ts`.** A round holds an order of seat ids rather
  than `a` and `b`, a `passedTo`, and who has spent their pass *this round*.
  `other()` becomes `next()`, which skips nobody because out players are not in
  the order.
- **`game.ts` is new.** It holds the whole game: who was dealt in, who is out,
  the pot, what each seat has spent, the current round, and the nets.
- **`table.ts`** keeps seating, and gains ready flags, the countdown, the opener
  rotation and the new view. Holding a leaving seat until the felt clears works
  as it does now.
- **`adapter.ts`** takes antes over any number of seats. It acts on `ready`,
  `roll` and `pass`. Its pauses are `countdown`, `round` and `result`.
- **`bot.ts`** reads the solver.
- **`listing.ts`** gains 2–6 seats, `COUNTDOWN_MS = 20_000`,
  `ROUND_MS = 3_000` and `RESET_CEILING = 100`. It loses `DEAL_MS` and
  `SHORT_RETRY_MS`.
- **The web client** gets the rail and grid, the ready screen, the height fix
  and the seat picker.
- **`CLAUDE.md`** gets the one-sentence amendment above.

This work sits on its own branch off `master`. The duel's PR is merged.

## CLAUDE.md, line by line

| Rule | How this meets it |
|---|---|
| Chips only won from real people | The pot is antes and passes; one player takes it; no bank |
| No bots at a chips table | Unchanged — the table refuses them |
| No chips game for one player | Two funded players are required to deal |
| Waiting costs nobody a stake | Ready moves no chips; antes go on only at the deal |
| Play money never touches an account | Unchanged |
| The server is the only authority | Every rule is enforced at the table; the readout is display only |
| A cryptographic source | Unchanged — `randomInt` |
| A press lands immediately | Ready shows on the press; roll and pass as before |
| Everything animated | Going out and the countdown each get one motion, with an off switch |
| Works on a phone | Grid layout, checked at 375px |
| A table that deals itself | Ready plus a countdown the table runs itself; amendment proposed |

## Testing

Test-first, as before. The tests carrying the weight:

**`odds.test.ts`**
- The solver's no-pass case matches the two-player closed form, and a
  brute-force recursion for three to six players.
- No player, in any state, at any table size from two to six, passes above
  ceiling 8. This is what makes capping the exact solve at 32 safe.
- The first-pass thresholds in the table above.
- With everyone holding a pass and pass-backs allowed, nobody passes first —
  the finding behind the second rule, pinned so it cannot quietly come back.

**`round.test.ts`**
- A roll passed to you cannot be passed.
- Passes are fresh each round.
- A 1 ends the round and names who went out.

**`game.test.ts`**
- Elimination runs to one winner.
- Every round after the first starts at 100.
- The opener is the seat after whoever went out.
- The nets sum to zero with passes spread across rounds.

**`table.test.ts`**
- All ready deals at once.
- Two ready starts the countdown, and its end deals only the ready players.
- Somebody sitting down does not restart the countdown.
- Ready dropping below two abandons it.
- Ready resets after a game.
- Bots are always ready.
- A mid-game arrival waits.

**`adapter.test.ts`**
- A refused ante sits that player out without stopping the deal.
- A store throw mid-deal hands every ante back.
- A player leaving mid-deal is refunded.
- Fewer than two funded refunds everybody.
- A failed deal does not retry by itself.
- The winner is paid the whole pot, including passes from earlier rounds.
- The clock rolls a passable roll rather than spending the pass.

**Server socket** — a three-player game over three sockets, balances checked
at the end.

**Web**
- The rail at desktop width and the grid at 375px. These are checked on a real
  screen rather than in the unit tests, since jsdom does not lay anything out.
- Pass is absent on a roll passed to you.
- The ready screen and the countdown.
- A ready press shows at once and is given up on refusal.

## Deliberately not in this version

- **More than six seats.** Six is what the phone grid holds without scrolling.
- **Carrying passes across rounds.** They are fresh each round, so the final
  duel is a real duel.
- **A host-set countdown length.** Twenty seconds for every table; it can become
  a host option later without changing anything else.
- **A split pot.** The last one standing takes it all.
