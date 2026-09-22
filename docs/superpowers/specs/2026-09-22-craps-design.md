# Craps — design

Two dice, a point to make, and a rail of people shouting. The sixth game in
the building to pay from a bank, and the most complicated cloth in it: a
dozen kinds of bet, several of which survive the roll that did not resolve
them, over a hand that runs for as long as the shooter keeps the seven away.

It is a table in the sense the room means — seats, a host, a code to share —
and a house game in the sense CLAUDE.md means, which is the part that has to
be argued before a chip can be laid on it.

## Why it can exist

A craps table settles everybody against the house, so it is a game that can
run for one player. CLAUDE.md allows that on exactly one footing, and craps
takes it whole:

- **A bank players alone fill.** Every stake enters `craps`' own bank as the
  chip lands, before the dice decide anything. The only chips entering from
  outside play are an admin's float, by the same authority that mints
  redemption codes.
- **It can never pay out more than the bank holds.** Worked out below, and
  arithmetically rather than probably.
- **A cryptographic source.** The dice come from the same `node:crypto` source
  the reels, the shoe and the wheel come from. A table hands every watcher its
  whole result every roll, which over an evening is exactly the run of
  observations needed to recover `Math.random`'s state.
- **No free rounds**, so that clause does not arise. **No deck**, so the
  reshuffle clause does not either.

It keeps **its own bank**. Craps holds back about 1.4% on the line and rather
more in the middle of the cloth — between blackjack's half a percent and
plinko's three — and a shared bank would be one game quietly paying for
another. The list in `packages/economy/src/store.ts` gains a sixth name.

## The dice

Two six-sided dice, thirty-six **ordered** outcomes. Ordered and not the eleven
sums, because the cloth can tell a 4+4 from a 5+3 and pays them differently —
a hardway is the pair, not the total. Every module that reasons about exposure
walks all thirty-six.

```ts
export const OUTCOMES: readonly (readonly [Die, Die])[]  // 36, in order
export function roll(pick: (faces: number) => number): [Die, Die]
```

`pick` is handed in, never defaulted, for the reason roulette's `spin` says:
this module is imported by the felt as well as the server, and a default would
mean reaching for `node:crypto` in a file that has to run in a browser. The
server passes the same source the reels use. `pick` chooses a face index rather
than a total, so a test can say "both dice came up three" without arithmetic.

## The cloth

Every bet is a `Spot` with a stable id. A client says `place` and a spot id; a
message naming a bet that does not exist looks nothing up and so buys nothing.
This is the same safety property `games/roulette/src/bets.ts` documents, and
the reason nothing on the wire ever carries a payout or a set of numbers.

### The line

| Spot | When it may be laid | What it does |
|---|---|---|
| `pass` | come-out only | 7, 11 win 1:1. 2, 3, 12 lose. Anything else sets the point. Point rolls again, wins; 7 loses. |
| `dontpass` | come-out only | 2, 3 win 1:1. 7, 11 lose. 12 pushes (bar the twelve). Anything else sets the point. 7 wins; the point loses. |
| `come` | point on only | Its own come-out on the next roll: 7, 11 win; 2, 3, 12 lose; anything else travels to that number. Travelled: its number wins, 7 loses. |
| `dontcome` | point on only | Mirrored. 2, 3 win; 7, 11 lose; 12 pushes; anything else travels. Travelled: 7 wins, its number loses. |

A travelled bet is not a new kind of thing — it is the same chip on a
different spot. `come` becomes `come:6`, `dontcome` becomes `dontcome:6`, and
those destination spots exist in `SPOTS` like any other. Nothing on the cloth
is ever a bet the table cannot name.

**A contract, once the point is on.** `pass` and a travelled `come` cannot be
taken down — that is the trade for the price. `dontpass` and `dontcome` can,
because taking them down is always against the player's own interest and a
table that forbade it would be protecting nobody.

### Free odds

Laid behind a line bet once it has a number, at true odds and no house edge at
all:

| Point | Taken (pass/come) | Laid (don't pass/don't come) |
|---|---|---|
| 4, 10 | 2:1 | 1:2 |
| 5, 9 | 3:2 | 2:3 |
| 6, 8 | 6:5 | 5:6 |

The spots are `odds:pass`, `odds:dontpass`, and `odds:come:4`…`odds:come:10`
and `odds:dontcome:4`…`odds:dontcome:10` — one per number a come bet can have
travelled to, because a player may have several come bets working at once and
each carries its own odds.

Capped at **3-4-5×** the line bet — three times on 4 and 10, four on 5 and 9,
five on 6 and 8 — which is the standard table's cap and has the property that
the odds payout is always exactly six times the line bet whatever the point
is. A lay is capped at whatever would *win* the same amount. The bank's own
cap applies on top of both and may be tighter; the smaller of the two is what
the felt offers.

Odds are **off on a come-out roll**, as at a real table. A come bet's odds do
not act on the roll that is deciding a new come bet.

### The numbers

| Spot | Pays | Resolves |
|---|---|---|
| `place:4`, `place:10` | 9:5 | its number wins, 7 loses |
| `place:5`, `place:9` | 7:5 | " |
| `place:6`, `place:8` | 7:6 | " |
| `big:6`, `big:8` | 1:1 | " |

Place bets are **off on the come-out** by default, which is the real rule and
also cuts the table's exposure for nothing. One toggle per seat works them, and
the big 6 and big 8 follow it — they are the same bet on the same number and a
table where one of them slept through the come-out and the other did not would
be a table nobody could read.

They stay up when they win. That is the fact the bank section has to answer.

### The field, the hardways and the middle

`field` — one roll. 3, 4, 9, 10, 11 pay 1:1; 2 pays 2:1; 12 pays 3:1;
everything else loses.

`hard:4` 7:1, `hard:6` 9:1, `hard:8` 9:1, `hard:10` 7:1. Won on the pair, lost
on the same total made any other way or on a 7. Working on the come-out.

One-roll propositions: `any7` 4:1, `anycraps` 7:1, `two` 30:1, `twelve` 30:1,
`three` 15:1, `eleven` 15:1, `horn` (2·3·11·12, split four ways, each paying
its own odds), `ce` (any craps and eleven, split two ways).

## The tray, and why it is what it is

```ts
export const CHIPS = [3000, 1500, 600, 300, 150, 60, 30] as const;
export const MIN_CHIP = 30;
```

Thirty rather than the twenty-five the wheel and the card tables use, and the
reason is arithmetic rather than taste. Craps pays in sixths, fifths, halves
and quarters — 7:6 on the six, 3:2 on odds behind the five, a horn split four
ways — and a tray of twenty-fives cannot pay any of them in whole chips. A
twenty-five on the six owes 29.166.

A real table solves this by demanding multiples: the six and eight take
multiples of six, the odds behind the five take an even number. Thirty is
divisible by 2, 3, 5 and 6, so **every denomination in this tray pays every
bet on this cloth exactly**, and no spot has to demand anything — which is a
much better table to sit at than one that refuses your chip and explains why.

Rounding was considered and rejected in both directions. Rounding down shaves
the player on free odds, whose entire point is that they carry no edge.
Rounding up pays 30 on a 30 place-six, which is true odds — it deletes the
house edge and the bank never fills.

The one exception is the horn, which splits four ways: it takes multiples of
**60**, and 60 is in the tray. `ce` splits two ways and needs nothing.

## The bank

### What a roll can cost

`owed(bets, point)` is the largest total the table could be asked for by one
roll, taken across the **whole cloth** — everybody's chips, not one seat's.
One pair of dice settles all of them, so a cap derived per seat would be a
promise about one player made in front of eight. This is the argument
`games/roulette/src/bank.ts` makes at length, and it applies here with more
force, because a craps roll can settle a dozen different kinds of bet at once.

```ts
owed(bets, point) = max over the 36 ordered outcomes of
                      Σ over bets of back(bet, outcome, point)
```

where `back` is what that bet hands over on that outcome, stake included, and
zero for a bet that loses or does not resolve. Exact, thirty-six times the
cloth, every time a chip goes down — the same trade roulette makes and for the
same two returns: a promise that holds, and a table far more generous than a
crude cap could be. Equal money on `pass` and `dontpass` can never both come
in, so between them they need no bank at all, and a table that understands
that takes bets all evening that a cruder one would refuse.

### What one more chip may be

`headroom(bank, bets, point, spot)` is solved rather than searched, and is
roulette's inequality generalised by one step. Adding `x` chips to a spot
raises what outcome `o` owes by `x · mult(spot, o)` and raises the stakes by
`x`, so for every outcome:

```
already[o] + x · mult(spot, o)  ≤  bank + staked + x
x · (mult(spot, o) − 1)         ≤  bank + staked − already[o]
```

The generalisation is that `mult` varies by outcome and not only by spot — the
field pays 1:1, 2:1 and 3:1 depending on what comes up, where every roulette
spot pays one figure. Outcomes where `mult ≤ 1` can never bind, because the
stake grows at least as fast as the liability; so the answer is the floor of
the minimum, over outcomes where `mult > 1`, of `(bank + staked − already[o]) /
(mult − 1)`.

The bank goes in as it is, never clamped up to nought first, for the reason
roulette's headroom documents: a clamp hands the arithmetic a richer bank than
exists while the chips on the cloth go on counting in full. Only the result is
floored, so an overdrawn bank offers nothing, which is the honest answer.

`mult` is what one chip **hands over** on that outcome, which for a bet that
stays up is its winnings alone and not its stake. A place six paying 7:6 hands
over seven chips for every six and keeps the six on the cloth, so `mult` is
7/6 and not 13/6. That is what makes the inequality above true rather than
merely conservative, and it has a consequence worth writing down: a place bet
of `x` needs only `x/6` of bank behind it, because its own stake is already in
there. Each hit walks the bank down by `x/6` rather than by the whole payout.
At the cap `x` is six times the bank, so `x/6` is the bank entire and a single
hit flattens it; it takes six hits to do that from a sixth of the cap. Either
way the rule below arrives exactly when the arithmetic says it should.

This cap is **exact for the roll in front of it and makes no promise about the
next one**. It cannot: a place bet's liability is a geometric tail, and a cap
that tried to cover every future roll would either be infinite or a guess
dressed up as arithmetic. The guarantee lives in the rule below instead, which
is checked before every roll and so is never stale.

### The guarantee: bets that cannot be covered go off

A place bet stays up when it wins and pays again the next time its number
comes. That is an unbounded run of payouts, and "unbounded but unlikely" is
exactly what CLAUDE.md refuses. So the load-bearing rule is not the cap on
placing; it is a check before the dice leave the hand:

> Before every roll, the table works out `owed(working, point)`. If that
> exceeds what the bank holds plus what is on the cloth, bets are taken **off**
> until it does not.

An off bet neither wins nor loses. The chips are untouched and still the
player's; the bet simply does not act on that roll, and comes back on the
moment the bank can carry it or the hand ends. "Off" is a state a real craps
table already has, which is why this reads as a rule of the game rather than
an apology from the software.

They go off in a fixed order, biggest multiplier first, so the cheapest
promise to keep is the last one broken:

```
props → hardways → field → place and big → odds → come/don't come → the line
```

The line is last and in practice unreachable; getting there means the bank is
destitute, and the alternative to turning a contract off is failing to pay a
winner, which is worse. The felt says which bets are off and why, in words,
while it is happening.

Two things follow. Overpaying becomes arithmetically impossible rather than
improbable. And every failure of this table falls on the player's side — a bet
that is off cannot lose.

### The float, and what a bank can offer

`capOf("craps")` answers "what could this bank take at all" for the admin desk,
and the answer is `bank / 30`: the worst a lone chip can do is a 2 or a 12 at
30 to 1. A real table is capped far more finely than that, chip by chip against
the whole cloth, but that route is asking a different question.

A bank with nothing in it is said on the felt before anybody presses anything,
the way roulette says it: "The bank is empty — nothing to play for yet."

### Play money

A for-fun table's purse and bank both live on the table and are gone when it
closes. Every figure above is run unchanged against them — the same cloth, the
same exact exposure, against numbers that were never anybody's. `FUN_PURSE`
and `FUN_BANK` are seeded well past the tray's largest chip so the whole rail
is playable from the first roll.

Bots are dealt in at for-fun tables and refused at every other kind.

## How a hand runs

Two clocks, and they are not the same thing.

**The hand** is `comeOut` or `point: N`. It lasts until the point is made or a
seven comes, which may be one roll or thirty.

**The round** is four phases going round — roulette's three, and one more:

```
betting  — the window, 15 / 30 / 60s, the host's choice
sealed   — no more bets; the bank is asked what it can carry
rolling  — the dice in the air, ~2.4s
settling — what the roll did, on screen, ~4s
```

`sealed` has no clock and is over in a round trip to the store, but it has to
exist. The off rule below is the table's whole guarantee and it has to be
checked **inside the bank's own queue**, where nothing else can move the bank
between reading it and the dice deciding. Joining that queue is asynchronous;
the hook a game gets for a timed phase (`pause().run`) is not. So `betting`
ends by sealing the cloth, and the adapter's `payOut` — which runs on every
broadcast, is asynchronous, and can ask for a re-broadcast when it changes
something — reads the bank, decides what is working, rolls, and starts the
dice. Death roll takes its antes the same way and for the same reason.

The alternative was checking against the last figure the adapter happened to
cache, which is a guarantee made against a number that may be stale. A stale
guarantee is not one.

`lastCall` is `min(5s, window / 3)` — a ceiling rather than a flat figure, or a
fifteen-second window opens already shut, which is the bug roulette's
`lastCallMs` was written to fix.

### The shooter

One seat holds the dice. They roll by pressing, and **the window's own deadline
rolls for them if they do not**. That is the whole of CLAUDE.md's "a table that
deals itself": a ready button one idle player can hold shut is a table that has
stopped dealing. The dice pass to the next seated player on a seven-out, and
immediately if the shooter leaves.

The shooter is not required to have a line bet. A real table insists; a table
here that refused to roll until somebody bet would be a table one person can
stop.

### When the table holds

A cloth with nothing on it and no point established does not roll. A stream of
results nobody bet on is noise and would walk the roll board along until the
last real roll had scrolled off it. The felt is left exactly as it is and a
fresh window opens — which is also CLAUDE.md's rule that a table holding must
hold with the felt untouched.

Once a point is on the table always rolls, whatever is on the cloth. The hand
has to finish.

### Leaving

Chips leave an account as they land on the cloth, so standing up gives up
whatever is down — the same bargain roulette makes, and the nav asks twice
while the window is open. A seat that leaves while bets are open has its chips
handed back where the bank allows it (the cover check below); once the dice are
in the air, what is down rides, and whatever the dice decide is paid to that
account whether or not the seat is still there.

Because a craps hand outlives a round, the table remembers the account behind a
departed seat until **the hand** ends rather than until the cloth is swept.
Roulette prunes on the sweep; doing that here would forget a player halfway
through their own point.

### Taking chips back

A chip coming off the cloth comes out of the bank, and what it leaves behind
does not get cheaper for it — `pass` went down against the bank, `field` was
then allowed to lean on it, and lifting `pass` leaves `field` owed more than
the bank holds. So a take-back is refused when it makes the shortfall worse,
and only then, so a bank drained from elsewhere never traps anybody's chips.
This is roulette's `lifts`, unchanged in shape.

On top of that, the contract rule: `pass` and a travelled `come` cannot come
down once they have a number.

## The code

```
games/craps/
  package.json                    @backroom/game-craps
  src/
    index.ts        the barrel
    listing.ts      CRAPS, open: true
    theme.css       the tokens listing.theme repeats
    dice.ts         two dice, the 36 ordered outcomes
    spots.ts        every bet: id, kind, and what each outcome pays it
    resolve.ts      what one roll does to one bet, given the hand
    bank.ts         owed, headroom, the off rule, CHIPS, FUN_*
    bets.ts         Placed / Paid / settle / toBets
    table.ts        phases, the shooter, the point, working and off
    bot.ts          for-fun bots
    adapter.ts      GameAdapter and the bank plumbing
```

`listing.ts` takes craps' entry out of `packages/core/src/coming.ts` and moves
it in here beside the rules, the way roulette's and two-up's did, keeping the
same theme colours the sign has always had: wall `#1a1610`, felt `#33280f`,
accent `#c08a1e`, accentHi `#ffd166`.

`resolve.ts` is the one file with the whole rulebook in it, and it is a
function of `(spot, outcome, hand)` returning what comes back and what the bet
becomes. Splitting it out from `spots.ts` is what lets the payout table be
tested exhaustively without the table class anywhere near it.

### The client

```
apps/web/src/craps/
  Craps.tsx        the page: lobby, then the felt
  Cloth.tsx        the cloth — spots, chips, aiming
  layout.ts        spot geometry in grid units, both arrangements
  Dice.tsx         two dice, tumbling and then not
  throw.ts         the flight path, derived from the result
  Rail.tsx         the puck, the roll board, the winners board
  Controls.tsx     the tray, same again, undo, clear, working
  craps.css        imported by Craps.tsx — checked, not assumed
  useThrowSound.ts
```

`craps.css` is imported from `Craps.tsx` and nowhere else, and that import is
written before the first rule is. This repo has had orphan stylesheets that
nothing loaded.

## How it feels

### A press lands immediately

Every move is a round trip and a round trip is long enough for a button to feel
broken. The bargain, and its one rule — never invent a fact:

- **A stake is the player's own number**, so the chips go down on the press,
  before the server has heard of them. Replaced the moment the table speaks,
  given up on if refused or if the answer never comes.
- **The dice are not.** So the press throws them: they leave the rail and
  tumble, faces unreadable, and settle onto the real faces when the answer
  lands. One arrival, not two — the dice that were thrown are the dice that
  stop, never a set that vanishes and a second set that appears.
- **The puck does not move** until the server says the point is on. Where the
  point lands is the server's fact.

Tested on a clock with fake timers, not by eye. On a machine talking to itself
the reply lands inside a frame, and a version that never worked at all looks
perfect right up until somebody plays from another continent.

### Everything that happens is animated

Each motion answers "what just changed?" without a word.

- The dice cross the felt from the shooter's rail, strike the back wall and
  settle with a little overshoot. The path is a pure function of the result in
  `throw.ts`, the way two-up's `toss.ts` and plinko's `flight.ts` are, and is
  unit-tested rather than eyeballed.
- A stake lands chip by chip.
- The puck slides from OFF to the point and turns over.
- A come bet **slides** from the come box to its number. It changes identity
  mid-motion — `come` becomes `come:6` — and the motion continues across the
  change rather than restarting, which is the rule about two animations
  fighting over one element.
- A winning spot pulses once, a losing one dims. Neither loops.
- A bet going off is marked with an OFF lozenge that arrives, not a colour that
  merely changes.

Every keyframe has an off switch under `prefers-reduced-motion`, and the felt
says everything it needs to without any of them. Sound is synthesised for the
interface and sampled for the dice, quiet enough to live under twenty presses,
and under the player's own volume and mute.

### It works on a phone

A real cloth is double-ended only so two crews can reach it; one end is the
whole game. The desktop gets that end, laid out as a casino prints it. Below a
threshold the cloth measures **its own** width with a `ResizeObserver` — its
own and not the viewport's, because the same cloth is narrow beside a rail on a
desk and wide on a tablet held sideways — and the sections stack:

```
Line  ·  Numbers  ·  Field  ·  Centre
```

The geometry in `layout.ts` is in grid units, so the second arrangement is one
swap and not a second set of figures. Nothing scrolls sideways. Roll and
take-back sit within one thumb of the bottom. Hover reveals nothing that is not
also reachable without it. Checked at 375px before it is called done.

## Where it has to be announced

The same list two-up needed:

| File | What |
|---|---|
| `packages/core/src/coming.ts` | craps' entry leaves |
| `packages/economy/src/store.ts` | `"craps"` joins `BANKS` |
| `apps/server/src/server.ts` | catalogue, bank object, adapter, `capOf` |
| `apps/server/src/meta.ts` | the house-games sentence |
| `apps/server/src/og.ts` | a motif for the link cards |
| `apps/server/package.json` | `@backroom/game-craps` |
| `apps/web/src/App.tsx` | `/craps` and `/craps/:code` |
| `apps/web/src/room/Room.tsx`, `TileArt.tsx` | the tile and its art |
| `apps/web/src/admin/Banks.tsx` | a panel, or the bank cannot be floated |
| `apps/web/src/game/audio.ts` | the dice cue |
| `apps/web/package.json`, `vite.config.ts` | the dependency and `optimizeDeps` |
| `CLAUDE.md` | the repo shape list, and the sentence naming the games on the bank footing |

A bank added to the store and forgotten in the admin room is a game that
silently will not deal, which is what happened to the wheel.

`CLAUDE.md` is the one that is easy to forget and the one that matters most.
It currently says slots, blackjack, roulette, two-up and plinko are **the five
games in the building on this footing**, and that a sixth would have to earn
all of it the same way. Craps is that sixth. The sentence becomes six games,
and the shape-of-the-repo block gains `games/craps`. A house rule that has
quietly stopped describing the house is worse than no house rule.

## Testing

Every bug fix gets a test that has been watched failing against the old code.
Flakes are bugs.

**The rulebook, exhaustively.** `resolve.ts` is a pure function of spot,
outcome and hand, so every bet against all thirty-six ordered outcomes, on a
come-out and on each of the six points, is a table that can simply be
asserted — including the twelve pushing on `dontpass`, the hardways losing to
the easy way, and the horn's four-way split.

**The bank.** That `owed` is the worst of the thirty-six and not the sum of the
bets; that matched line money needs no bank; that `headroom` never offers a
chip the table cannot cover, checked by placing the chip it offers and
re-measuring; that an overdrawn bank offers nothing rather than throwing.

**The off rule.** A bank walked down by a run of place hits turns bets off in
the documented order and never turns off more than it must; an off bet neither
wins nor loses; it comes back on.

**The table.** Phases and their deadlines; the shooter passing on a seven-out
and on leaving; the window rolling when the shooter does not; a point forcing a
roll on an empty cloth and an empty cloth otherwise holding with the felt
untouched; contract bets refusing to come down.

**The adapter.** Staking into the bank before anything is decided; a refused
place putting the chips straight back; take-backs under the cover check;
leaving mid-window and mid-hand; `void` returning every chip; the bank refusing
a payout being logged loudly; bots refused at a chips table.

**The socket.** `apps/server/src/craps.socket.test.ts`, following
`roulette.socket.test.ts`: a table created, joined, bet at, rolled and settled
over a real socket.

**The client.** The optimistic chip and its replacement and its rollback, on
fake timers. The throw path's arithmetic. `layout.ts` in both arrangements —
that every spot is reachable, that none overlap, and that nothing exceeds the
grid. That `craps.css` is imported. That every keyframe it defines is turned
off under `prefers-reduced-motion`.

## Not in this design

Fire bets, the all/tall/small side bets, put bets, buy and lay on the numbers
with commission, and crapless craps. Each is a bet menu decision that can be
added to `spots.ts` and `resolve.ts` later without touching anything above it,
and none of them changes the argument the bank section makes. YAGNI.
