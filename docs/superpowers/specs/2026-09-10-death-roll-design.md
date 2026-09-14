# Death Roll — design

Two people and a number that only goes down. You roll, the number becomes
whatever you rolled, and you hand it to the other one. Roll a 1 and you have
lost. The whole game is watching a four-figure number turn into a two-figure
one and knowing whose turn is next.

It is already listed. `COMING` has carried it since before there was anything
to put in `games/` — two seats, "Halve the number or pay", and a violet room —
and this is the design that makes the sign into a door.

## The duel

A host opens a table with a **stake** and an **opening ceiling**. Two seats,
never more and never fewer; the reason is in `coming.ts` and has not changed.

Both players ante the stake and one of them is handed the roll. On your turn
you take one of two moves:

**Roll.** A uniform draw from 1 to the ceiling. A 1 and the duel is over and
you have lost it. Anything else becomes the new ceiling, and the turn passes.

**Pass.** Pay a tenth of the ante into the pot and hand the roll back at the
*same* ceiling. **Once per player per duel**, and when it is gone it is gone
until the next one.

The loser pays; the winner takes the pot. Whoever rolls first is drawn at
random for the first duel of a table and alternates after it.

A ceiling of 1 cannot be reached — a roll of 1 ends the duel rather than
setting the ceiling — so every turn begins at 2 or more, and the roller is
never asked for a draw it cannot make.

## Why the pass is capped at one each

Without a cap the game does not terminate, and not in a subtle way.

If passing were free of any limit, the correct play is to pass on **every**
turn. Your opponent rolls, the ceiling comes down, it is your turn again, and
you pass again. You never roll at all, so you can never roll a 1, so you
cannot lose — you have bought the duel outright for whatever the passes cost.
Any price makes that a bad deal eventually, but "eventually" is not a rule, and
a game whose termination argument is a pricing argument is a game with a bug in
it.

One pass each is the cap, and it is the cheapest one that works: **a duel holds
at most two passes**, so it always ends, and it ends by somebody rolling a 1.

It also turns out to be the best version of the game rather than merely the
safe one. Because a pass is worth almost nothing at a high ceiling and a great
deal at a low one — see the arithmetic below — holding yours is the only skill
the game has. Spend it at 20 and you have thrown it away. Hold it to 3 and you
have taken the duel off somebody.

## The arithmetic

Let `L(N)` be the chance that the player **about to roll** at ceiling `N` is
the one who eventually rolls the 1.

```
L(1) = 1
L(N) = 1/N + (1/N) * sum over r in 2..N of (1 - L(r))
```

which rearranges to `L(N) = (N - sum of L(2..N-1)) / (N + 1)`, and that has a
closed form:

```
L(N) = 1/2 + 1/(N(N+1))
```

`L(1) = 1` falls out of it, which is a good sign. It has been checked against
the recursion above for every `N` from 2 to 400 and agrees to 4.4e-16, and that
check is a test rather than a note in a document.

**The roller is always the underdog**, and the size of the disadvantage is the
whole design:

| ceiling | you lose | passing swings |
|--------:|---------:|---------------:|
|       2 |   66.67% |        33.33pp |
|       3 |   58.33% |        16.67pp |
|       5 |   53.33% |         6.67pp |
|       8 |   51.39% |         2.78pp |
|      10 |   50.91% |         1.82pp |
|      20 |   50.24% |         0.48pp |
|     100 |   50.01% |         0.02pp |
|   1,000 |  50.000% |        0.000pp |

Passing takes you from `L(N)` to `1 - L(N)`, a swing of `2/(N(N+1))`. At the
opening ceiling that is worth two millionths of the ante. At ceiling 2 it is
worth a third of it.

### What the pot does, and why the pass price is a tenth

The pot is `2 x ante` plus every pass paid into it, and the winner takes it.
Work the nets through and they are clean:

- **Win**: `+(ante + whatever your opponent spent on passes)`. Your own passes
  come back to you inside the pot.
- **Lose**: `-(ante + whatever you spent on passes)`.

Both nets are the same figure with opposite signs, and that figure is decided
entirely by what the **loser** spent. So the two sum to zero, always, and **a
pass is only ever paid for by the loser** — win and yours cost you nothing.
That is the right shape: passing is not a fee, it is a bet that you will not be
the one paying.

The expected-value arithmetic below simplifies a win to `+ante`, because at the
moment you are deciding, whether your opponent will spend theirs is not yet
known. That is the same simplification as "a little lower in practice" further
down, and it errs towards passing less often rather than more.

Rolling therefore has an expected value of `-2 x ante / (N(N+1))`, and passing
is worth paying for while

```
price  <  8 x ante / (N(N+1))
```

At a price of a tenth of the ante that is **ceiling 8 or below** — a little
lower in practice, because your opponent may spend theirs passing it straight
back. Roughly the last two or three rolls of a duel: long enough that the
decision is live more than once, dear enough that spending it early is a
mistake you can feel.

A tenth was chosen over a quarter (break-even at ceiling 5) and a half
(ceiling 3) because those leave the button worth pressing on at most one turn
of a duel, which is a decision in name only.

## Where the chips are

**No bank, and it needs no argument.** Every chip a winner takes came off the
other player at the same table. The room hands out nothing it was not handed
first, so the rule the building rests on is satisfied by the shape of the game
rather than by a cap derived from a worst case. Death roll joins Poker as the
half of the list that is cheap to make honest.

The economy is touched five times at most in a duel: an ante from each player
as it starts, up to one pass each, and the pot to the winner as it settles.

**Antes go on when a duel starts and at no other moment.** A table waiting for
a second player waits with the felt untouched — clearing it to wait would be
the table keeping the money, and putting chips down before there is anybody to
play against would be worse. One player alone means the table says so and does
not deal.

**Both antes are taken before anything is dealt, and a failed one is undone.**
`take` can refuse — somebody may have spent their balance at another table
between sitting down and the duel coming round — and a duel that took one ante
and failed the second would be a table holding a stake for a game that never
happened. So: take both, and if the second refuses, give the first straight
back and stay waiting. The felt says which seat is short.

### Which needs one small thing from the room

Taking an ante is asynchronous and a duel starts on a timer, and the room has
nowhere to put that combination. Every other game moves its state
synchronously and moves money afterwards — a hand is over the instant the last
card lands, and `settle` only catches the chips up. Death roll is the first
table whose *state change is the money*: the duel cannot start until both
antes are in, and nothing starts it but a clock.

`pause().run()` is synchronous, so it cannot take an ante. `payOut` is
asynchronous, unlatched and runs on every broadcast, which is exactly the
queue this needs — but the room never sends the state again afterwards, so a
duel begun inside it would be invisible until something unrelated woke the
table up.

So `payOut` gains a return value: **`Promise<void | boolean>`, where `true`
means "I changed the table, send it again"**. Every existing game returns
`Promise<void>` and is unaffected. Death roll returns `true` only on the
broadcast where it actually drained a pending duel, so the extra send happens
once and cannot recur.

The alternative — a table holding an at-table float so the timer had chips to
draw on — is the poker model, and it was considered and rejected: it makes
sitting down cost money before there is a game, which is the thing the waiting
rule exists to prevent.

A pass is debited at the press. A player who cannot afford one is refused by
the server; the client greys the button as a courtesy and never as the rule.

## The table's clock

A death roll table deals itself, like every other table in the building.

| status | what it is | what moves it on |
|---|---|---|
| `waiting` | fewer than two players, or between duels | both seats filled and funded, after a short pause |
| `dueling` | somebody's turn | a roll, a pass, or the turn clock |
| `over` | a duel decided, result on the felt | a pause, then back to `waiting` |

`isSettled` is true through `over`, which is the latch the room wants: the
result stays up long enough to read, `settle` fires once, and then the felt
clears and the next duel comes round. Nobody presses start.

Between duels the ceiling shows the table's opening number again, because that
is what the next duel will be played at.

## Leaving, and the turn clock

Thirty seconds to act. When it runs out **the table rolls for you**.

Rolling is chance either way, so a clock cannot disadvantage somebody who is
absent — there is no decision being taken away from them, only a pass they
were not going to be able to spend anyway. Forfeiting the duel on a timeout
would let a bad connection lose somebody their stake, which is the one thing a
clock must never do.

`leavesMidHand` stays false. Somebody who stands up mid-duel has chips on the
felt and the duel has to play out and settle before anybody can be paid, so
their seat is held and they are treated as dropped — blackjack's answer, for
blackjack's reason. Their turns auto-roll, the duel ends, the chips move, and
then the seat goes.

If a table is left with one player between duels it holds, says it is waiting
for an opponent, and antes nothing.

## For fun, and bots

A `forFun` table plays for the same stake as any other — the number on the
felt does not change, only where it comes from. Each seat is handed a play
purse of `FUN_PURSE = 10_000` when it sits down; antes and passes come out of
it and the pot goes back into it. It lives at the table and is gone when the
table closes, so no account is touched at any point.

A purse that cannot cover the next ante is refilled to `FUN_PURSE` rather than
the table refusing to deal. There is nothing at stake, so running dry should
cost somebody a moment rather than their evening — and a for-fun table that
stops dealing is a for-fun table nobody sits at twice.

Bots may sit at one. A bot at a table playing for chips is refused by the
adapter, not hidden by the client.

The bot's only decision is when to spend its pass, and it has the closed form
to decide with. `worthPassing(ceiling, ante, price)` is the honest answer;
skill wobbles the threshold around it:

| skill | passes at ceiling | thinking time |
|---|---|---|
| easy | never | slow |
| normal | 5 or below | mid |
| hard | 8 or below — the true break-even | quick |

## Where the randomness comes from

`randomInt(1, ceiling + 1)` from `node:crypto`, injected so tests can roll to
order.

Not `Math.random`, and the reason is the one already written down for the reels
and the shoe: **the game hands the player its whole result every single turn.**
A death roll is nothing but a run of observed outputs, which is precisely what
recovering xorshift128+ state needs — and somebody who knew the next roll would
know whether to spend their pass, which is the entire game. That there is no
bank behind this table does not help; the chips would be coming off the person
sitting opposite.

`randomInt` is rejection-sampled and so is uniform over any ceiling, which
scaling a float is not.

## Where the code lives

```
games/death-roll/
  package.json          @backroom/game-death-roll
  src/index.ts          the barrel
  src/listing.ts        DEATH_ROLL, stake levels, ceilings, passPrice()
  src/odds.ts           lossOdds, passGain, worthPassing        — pure
  src/duel.ts           the duel state machine                  — pure
  src/table.ts          seats, lifecycle, view()
  src/bot.ts            decide, thinkingTime
  src/adapter.ts        the GameAdapter
  src/theme.css         the room's colours
```

`duel.ts` is separate from `table.ts` so the rules can be tested without a
table and the lifecycle can be read without the rules. `odds.ts` is separate
from both because it is arithmetic, it is the thing most worth testing hard,
and the bot and the felt both need it.

### Numbers the game owns

```ts
export const STAKES   = [100, 500, 1_000, 5_000] as const;  // default 500
export const CEILINGS = [100, 1_000, 10_000] as const;      // default 1_000
export const PASS_DIVISOR = 10;
export const FUN_PURSE = 10_000;                            // play money only
export const TURN_MS = 30_000;
export const RESULT_MS = 5_000;
export const DEAL_MS = 2_000;
```

Every stake level divides by ten, so a pass price is always whole chips.
Both lists are snapped to on the way in rather than clamped, the way poker
snaps its buy-in: what a table costs and what it opens at are decisions about
everybody's evening, and a client that could name its own would be setting the
stakes for people who sat down expecting something else.

## The protocol

The view is free-form — `TableState` is `TableEnvelope & Record<string,
unknown>` — so nothing in `protocol.ts` has to learn what a ceiling is.

```ts
interface DeathRollView {
  code: string;
  // `phase`, not `status`: core already owns `TableStatus`, and roulette
  // settled this naming when it hit the same clash.
  phase: "waiting" | "dueling" | "over";
  seats: DeathRollSeat[];      // id, name, isBot, connected, pass spent
  watching: number;
  ante: number;                // the same number for fun or for chips
  purse: number | null;        // play money left, at a for-fun table only
  opening: number;             // the table's opening ceiling
  passPrice: number;
  ceiling: number;
  pot: number;
  toRoll: string | null;
  turnEndsAt: number | null;
  lastRoll: { seatId: string; from: number; result: number } | null;
  lastPass: { seatId: string; paid: number } | null;
  loserId: string | null;
  winnerIds: string[];
  waitingFor: "opponent" | "funds" | null;
  lastEvent: string | null;
}
```

Two actions, through the envelope every game already uses:
`{ type: "roll" }` and `{ type: "pass" }`. `actionSchema` checks the type and
nothing else, which is right — only the game knows what a pass needs.

**One addition to `@backroom/shared`**: `ceiling?: number` on `createSchema`
and on `lobby:create`, bounded `100 … 10_000`, beside `buyIn` and `window` and
for the same reason they are there. It is part of the shape of the table, so it
is the host's.

**One addition to `@backroom/core`**: `payOut` returns `Promise<void |
boolean>`, and the server sends the state again when it returns `true`. See
"which needs one small thing from the room" above for why. No existing game
changes.

### Server wiring

- `death-roll` comes out of `COMING`, exactly as poker did when it was built.
- `DEATH_ROLL` joins the catalogue and `deathRollAdapter` joins `ADAPTERS`,
  with the crypto roller.
- `/death-roll` and `/death-roll/:code` join the routes.

## The felt

Two seats facing each other and the number between them. The number is the
game, so it gets the middle of the screen and everything else gets out of its
way.

**The number falls.** A roll is digits tumbling and settling with a little
overshoot — one motion, from the ceiling that was to the number that is. It
does not fade and reappear; it is the same number all the way down, which is
what makes the fall mean something.

**The odds sit under it.** `you lose 50.9%`, ticking as the ceiling drops, so
the moment passing turns correct is something you can see rather than something
you have to know. This is the readout that makes the pass a real decision for
somebody playing their first duel.

**A 1 is short and hard.** No flourish. The number lands, it is a 1, the felt
says who has lost, and the pot slides.

### Pressing, on a bad connection

A press lands immediately, and never by inventing a fact.

- **Roll** starts the number *tumbling* on the press. Tumbling is not a
  guessed result — the digits are visibly unresolved — and it settles on the
  real answer when the server speaks. One arrival, not two.
- **Pass** puts the chips down on the press, because the price is a number the
  player already chose and the table cannot disagree about it.
- Either is given up on if the table refuses it or never answers.

Tested on a clock with a delayed transport, not by eye. A reply that lands
inside a frame proves nothing.

### On a phone

Checked at 375px. The seats stack, the number stays centred and stays the
biggest thing on the screen, and **Roll** and **Pass** are two thumb-width
buttons along the bottom within reach of one hand. Nothing scrolls sideways;
the duel's history of rolls scrolls inside its own box.

`prefers-reduced-motion` turns off the tumble, the chip throw and the pot
slide. The number still changes, the odds still tick, and the felt still says
everything it needs to.

### Sound

A rattle for the roll — physical, so sampled. A synthesised tick for the pass.
A short low hit for the 1. All under the player's own volume and mute, and
quiet enough to sit under twenty presses.

## The theme

The colours `coming.ts` already gave it, repeated in `theme.css` and in the
listing because the link cards are drawn on the server where there is no
stylesheet to read:

```
wall #16141c   felt #241f33   accent #6b4bd6   accentHi #b39cff
```

`mark: { text: "DEATH ROLL", accentAt: 0 }` — the D is lit.

## Stats and history

`record` per duel, under `death-roll`: `shared.games`, `shared.wins`,
`shared.chipsWon`, and `add: { duels, passes }`, `max: { pot }`.

`finished` writes the duel: the ceiling as `rulesetName`, the ante as `buyIn`,
the pot, both players with their `net` as derived above, and the winner. Net is
recorded rather than worked out later, because a page reading the history
cannot tell which game it is looking at.

## CLAUDE.md, line by line

| rule | how this satisfies it |
|---|---|
| chips only won from real people | pot in equals pot out; no bank exists to pay from |
| no bots at a chips table | adapter refuses; client hides as a courtesy |
| no chips game for one player | two seats required to deal; a lone player waits |
| waiting costs nobody a stake | antes go on at the start of a duel, never before |
| play money never touches an account | `forFun` purse lives at the table and dies with it |
| server is the only authority | both actions validated at the table; client only shows |
| cryptographic source | `randomInt`, because the game hands out its whole result |
| a press lands immediately | tumble on roll, chips on pass, never a guessed value |
| everything is animated | the fall, the throw, the slide — each says what changed |
| reduced motion | every keyframe has an off switch |
| works on a phone | checked at 375px, two thumb buttons |
| a table that deals itself | `pause` drives waiting → dueling → over → waiting |
| every bug fix gets a failing test | as ever |

## Testing

Test-first throughout. The ones carrying weight:

**odds.test.ts**
- `lossOdds` against the brute-force recursion for every N in 2…400.
- `lossOdds(1) === 1`, and the sequence is strictly decreasing towards 1/2.
- `worthPassing` flips at ceiling 8 for a tenth, 5 for a quarter, 3 for a half.

**duel.test.ts**
- a 1 ends the duel and the roller is the loser;
- any other roll becomes the ceiling;
- a pass leaves the ceiling alone and moves the turn;
- a pass is spent — a second one from the same player is refused;
- both players passing forces the next roll, so a duel holds at most two;
- the ceiling never reaches 1 at the top of a turn.

**table.test.ts**
- one player: no ante is taken, nothing is dealt, the felt stays clear;
- a duel starts only when both seats are filled and funded;
- the first roller alternates between duels;
- standing up mid-duel holds the seat; the duel finishes and then it goes;
- the turn clock rolls rather than forfeits.

**adapter.test.ts**
- `settle` gives the winner exactly the pot and nothing else;
- nets sum to zero across both players, including passes;
- a second ante that is refused gives the first one back, and no duel starts —
  the test that matters most here, because it is a table holding somebody's
  stake for a game that never happened;
- a `forFun` table takes nothing and gives nothing, however many duels it runs;
- a for-fun purse too short for the ante is refilled rather than stopping play;
- a bot is refused at a chips table and seated at a for-fun one;
- a pass a player cannot afford is refused.

**bot.test.ts** — passes at low ceilings, not at high ones, per skill.

**apps/server/src/server.test.ts** — a `payOut` returning `true` sends the
state a second time; one returning nothing sends it once. The recursion guard
matters more than the feature: this is a broadcast calling something that can
ask for another broadcast.

**apps/server/src/deathroll.socket.test.ts** — two sockets, a whole duel,
balances checked at both ends.

**apps/web/src/deathroll/DeathRoll.test.tsx** — the tumble starts on the press
and resolves to the server's number; the odds readout tracks the ceiling; the
pass button is absent once spent.

## Deliberately not in this version

- **More than two seats.** An elimination version is a different game and the
  listing has always said two.
- **A rematch button.** The table deals itself; a duel comes round on its own.
- **Rake.** Nothing in the building takes one and this is not where it starts.
- **A pass that can be bought back.** One each, gone when spent. The whole
  endgame is knowing who still has theirs.
