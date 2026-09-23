# Liar's Dice — design

Five dice under a cup each, and a count nobody can check. You claim there are
four fives on the table; the next player either claims something bigger or calls
you a liar, and then every cup comes up and the arithmetic settles it. The whole
game is a number going up past what anybody believes and watching who blinks.

Ten seats at the top end, which is more than any other table in the building
except Poker, and it is the thing the felt bends around: the game has to read on
a 375px phone with thirty dice in play.

## The game

A host opens a table with a **stake**, a **seat limit** and **how many dice**
each player starts with. Everybody antes the stake once; the pot is nothing but
those antes, and the last player holding dice takes all of it.

### A round

Every player still in has their dice rolled in secret. Bidding goes round from
the opener. On your turn you take exactly one of three moves.

**Raise.** Name a count and a face — "four fives" — bigger than the standing
bid. Bigger is defined below, and it is not a plain sort.

**Liar.** Every cup comes up. The dice showing the bid's face are counted, plus
every one as a wild. If the count **meets or beats** the bid, the bid was good
and the challenger loses a die. Otherwise the bidder loses one.

**Exact.** A claim that the count is *precisely* the bid. Right, and every other
player still in the round loses a die — not only the bidder. Wrong, and the
caller loses one. It is the press that ends games, and it is meant to be. There
must be a standing bid to call, so it is never the opener's move; and the player
who made the standing bid cannot call it, because the turn has already passed
them.

A player on zero dice is out. The round ends the moment somebody calls, and
whoever lost a die opens the next one — or, if that put them out, the next
player still in after them.

### Ones are wild

A one counts as whatever face is bid, unless the bid is on ones. That is what
gives the game its texture, and it is also what stops the bid ordering being a
sort: with wilds, "three ones" is *harder* to satisfy than "three fives",
because only actual ones can fill it. A lexicographic order on (count, face)
would make ones the cheapest bid on the board when they are in fact the dearest.

Dudo's arithmetic fixes it by pricing a bid on ones at double:

| Standing bid | A raise on a plain face | A raise on ones |
|---|---|---|
| `Q` of `f`, `f ≠ 1` | more than `Q`, or `Q` at a higher face | at least `ceil(Q/2)` ones |
| `Q` ones | at least `2Q + 1` | more than `Q` ones |

No bid may name more dice than are still in play. An opening bid is any count
from one up to that total, at any face.

### The order underneath it

Those four rules are one comparison wearing a disguise. Give every bid a key

```
key(count, face) = [ face === 1 ? count * 2 : count,  face === 1 ? 1 : 0,  face ]
```

and a raise is legal exactly when its key is lexicographically greater than the
standing bid's. Worth writing down because it is what makes the code small: one
`beats`, and `minRaise` is the least key above the standing one rather than four
branches of arithmetic to get wrong.

The middle element is load-bearing. At equal doubled count a bid on ones
outranks a bid on a plain face — that is the `ceil(Q/2)` rule when `Q` is even —
and ones carry face `1`, the lowest, so a face comparison alone would order it
backwards.

Two consequences, both authentic and both written down so they are not later
read as bugs:

- Bidding ones low takes bids off the board. Once "two ones" is out, nothing
  from "four twos" to "four sixes" can be said again; the next plain bid is five
  of something.
- Near the ceiling ones become the only raise. With thirty dice in play and
  "thirty sixes" standing, nothing beats it and the turn is call-or-call.

### Ending

One player with dice and the game is over; they take the pot. A resolution can
never empty the table: **liar** takes a die from exactly one of the two players
in it, so at least one other keeps theirs, and a correct **exact** never costs
its caller anything.

## The money

Death Roll's shape, and less of it — nothing at all is staked during a game.

- One ante per player, taken at the deal, into the table's escrow.
- The pot is only ever those antes. There is no bank, no house and so no
  exception to argue: every chip somebody wins here came off the people who were
  in the game with them.
- A table with fewer than two connected players does not deal, and holds
  nobody's stake while it waits.
- Bots are seated only at for-fun tables, where the purse lives at the table and
  dies with it.

Antes are taken in `payOut`, for the reason Death Roll takes them there: taking
one is asynchronous and nothing starts a game but the table's own clock, which
is not. The table records who it wants dealt and the adapter antes them on the
next broadcast, draining the request before its first await so that running on
every broadcast is exactly-once. Death Roll's hard-won cases come with it, as
tests rather than as prose:

- one player short of the ante sits that game out and nobody else does;
- a store that throws deals nobody and hands back everything it took;
- a player who leaves between antes — or during the refund of somebody who
  already left — is refunded and not dealt, re-checked until a pass finds nobody
  gone, with nothing awaited between that pass and the deal;
- a table called off while an ante was in flight refunds in full and deals
  nobody;
- fewer than two funded deals nobody.

### The dice come from the system generator

`randomInt`, injected, never `Math.random`. A challenge hands the whole table
every hand at once — thirty faces in one message — which is exactly the run of
observations that recovers the generator's internal state. Somebody who knew the
next deal would know whether to call, which is the entire game.

## Hidden hands

The first dice table in the building with secret state, and the view already
supports it: Poker nulls its hole cards per seat and this does the same.

- `you.dice` is faces. Every other seat's `dice` is an array of `null` the
  length of their hand, so the client can draw the right number of face-down
  dice without being told what they are.
- Every hand becomes real for everybody only in a resolution, which carries the
  revealed hands, the count and the outcome.
- The count is computed on the server and sent. The client never counts —
  anything a browser works out is something a player can work out early.

## The package

`games/liars-dice`, published as `@backroom/game-liars-dice`, id `liars-dice`.

| File | What it holds |
|---|---|
| `bid.ts` | `Bid`, `Face`, `key`, `beats`, `minRaise`, `countOf`. Pure; the rules live here and so do most of the tests. |
| `round.ts` | One round: hands, turn order, the standing bid, resolving liar and exact, who lost a die. |
| `game.ts` | Dice per player, rounds, elimination, opener rotation, the pot, the winner, per-seat counts for the record. |
| `bot.ts` | What a bot bids: the distribution over dice it cannot see, and a raise-or-call decision from it. |
| `table.ts` | `PlayTable` — seating, readiness, for-fun purses, and the per-seat view. |
| `adapter.ts` | `GameAdapter` — antes, settle, void, clock, timeout, pause, bot moves. |
| `listing.ts` | The listing, the stake and dice levels, the timings, and the snapping functions. |
| `theme.css` | The room's colours. |

### The listing

```
id        liars-dice
name      Liar's Dice
blurb     Five under a cup. Bid it up or call it.
shape     table
seats     2 to 10
mark      LIAR'S DICE, accent on the L
theme     wall #17110d  felt #2e1c14  accent #e2622c  accentHi #ff9a63
```

Ember orange on brown leather — the one lamp over a back table. No other game in
the building uses orange as its neon, and the values here and in `theme.css`
have to agree, because the link cards are drawn on the server where there is no
stylesheet to read.

### What the host chooses

- **Stake** — `[100, 500, 1_000, 5_000]`, default `500`. The same levels as
  Death Roll, so the floor reads consistently.
- **Dice each** — `[3, 5]`, default `5`. Three is what makes a ten-handed game a
  reasonable length; five is the game everybody knows.
- **Seats** — 2 to 10.

All three are snapped on the server. A client that could name its own stake
would be setting the stakes for other people.

### Timings

| | |
|---|---|
| A turn | 30s |
| A revealed round stays up | 6s — thirty dice and a count to read |
| A finished game stays up | 6s |
| The ready countdown | 20s |

### The clock never costs a stake or a die

A turn that runs out **bids the lowest legal raise**. It is the neutral move: it
resolves nothing, so a bad line cannot lose somebody a die or their ante. Only
when the bid is already at the ceiling and no raise exists does the clock call
liar, because by then there is no other move in the game. Either way the
activity log says the clock did it.

### The table deals itself

Everybody ready deals at once; two or more ready starts the countdown, and
whoever is ready when it ends is dealt. `Readiness` is exactly this, and it is
currently a private file in `games/death-roll`.

**Shared work, first commit:** move `ready.ts` and `ready.test.ts` into
`packages/core`, export `Readiness` from `@backroom/core`, and have Death Roll
re-export it so its public API does not change. A pure move — the class has
nothing dice-specific in it — and the table standard says shared pieces are
used, not copied.

## The felt

Ten seats is the constraint everything else bends around. Built to
`docs/superpowers/specs/2026-09-16-table-requirements.md` from the first commit
rather than migrated to it later; requirement ids are cited so the PR can say
which it meets.

### Three rows, one of them flexing

The page is the window (`play--fit`, L1). The table is a grid whose rows are
`auto` except the middle one, which is `minmax(0, 1fr)` and a
`container: ld / size` (L2, L3).

**The seat rail** (auto). One compact plate per seat: avatar, and the dice still
in front of them as up to five pips. A name only under the seat to act and under
your own — ten names at 375px is a wall of ellipses. Ten plates wrap to two rows
inside about 70px. The seat to act is lit in the room's neon, your own is
outlined in `--gr-color-chip-dim`, and a seat out, sitting out or gone is dimmed
rather than hidden, with its state said — visibly at a desk, to a screen reader
on a phone (T1).

**The play area** (`1fr`). The standing bid as the one big readout — "four
fives", with the pot and the dice in play beside it as one block, and the turn
clock draining along its top edge (T2). Your own hand under it, every die sized
`min(…cqi, …cqh)` and clamped, set on the container only so it inherits (L3, L4,
guarded in `liarsdice.css.test.ts`). A short phone shrinks the dice rather than
pushing the controls under the fold.

**The controls** (auto). Six face lamps, a `−`/`+` count stepper, then `Liar` ·
`Exact` · the lit `Bid` slab. The slab says what it will do — "Bid four fives" —
and the lamps and stepper dim what the standing bid makes illegal, so the aces
arithmetic is enforced by the table and merely *shown* here (F5, N6). One lit
thing per state (F2), every key at least 52px, secondary left and the main
action right (K1).

Past 760px of table the same markup rearranges (L5): the felt on the left, and a
side column with the readout, the rules card and the activity log.

### The picker's defaults

The lamps and the stepper arrive preselected, because a player who has to build
a bid from nothing on a 30s clock will mis-tap.

- Raising: the **lowest legal raise**, from `minRaise`.
- Opening: count `max(1, round(total / 3))` at face two. Neutral on purpose —
  `total / 3` is the expected count of any face once wilds are counted, so the
  default tells the table nothing. A default that preselected your own real
  count would be a tell, learnable by anybody who noticed it.

### The rules are within reach

The aces table is the one thing a player must be told rather than shown. It sits
behind a `?` key on the play area on a phone and in the side column at a desk,
with the row that applies to the standing bid lit (T3).

### Talk, activity, refusals

The shared pieces, not copies (section 12 of the standard): `TalkSheet` behind a
counting talk key on a corner of the felt (C1, C2), `useActivity` over
`lastEvent` for the table's sentences (A1, A2), and `Refusal` over a blurred
board for anything the table turns down, keyed on `errorKey` so the same words
twice show and sound twice (N1–N4).

The table keeps its own **board** of the last few rounds — the bid, the count
and who lost a die — which is the game's record of results and not the activity
log (A3). Because nothing in the view is a roll counter, the view carries a
sequence number bumped on every action the table reports, so two identical
sentences are two lines (A4).

## How it feels

### What lands at once, and what cannot

- A bid is a number the player chose, so it lands on the press: the readout
  changes to it and the slab goes `.is-busy` until the table answers, dropped on
  `errorKey` as well as `error` (F4, S2).
- A die is not yours to guess. A new round shows the cups shake and the dice
  arrive **face down** — one arrival, not two — and only your own turn over,
  when the answer lands (T4).
- A call is a press whose answer is the whole reveal, so it shows as the button
  going down and the felt holding its breath, never as a guessed count.
- Tested on a clock rather than by eye. On a machine talking to itself the reply
  lands inside a frame, which is exactly how a version that never worked at all
  gets shipped.

### Motion

- The cups shake and set down, dice staggered a beat apart.
- A reveal turns every other hand over in one staggered motion, then the count
  ticks up over the dice that matched.
- Losing a die is one motion: it slides out of the hand and dims. Somebody's
  last die is the one lit moment the standard asks for (T5) — once, not looped.
- One motion per element. A die that turns over mid-slide continues its slide.
- Every keyframe added goes in the sheet's own `prefers-reduced-motion` block,
  and the felt still says everything without them (M1).

### Sound

From the set that exists: `shake` and `land` for the roll, `sayRaise` for a bid,
`sayCall` for liar, `reveal` for the turn-over, `potPush` and `win` at the end,
`yourTurn`, `refused`. One cue is added to `audio.ts`: `sayExact`, because exact
is the rarest and loudest press in the game and borrowing liar's voice for it
would make the two indistinguishable at the moment it matters most.

### Keys

Space bids, **L** calls liar, **E** calls exact, each declared on its button with
`aria-keyshortcuts` (K2). The K3 exclusions hold — no shortcut inside an input or
a dialog, none with Ctrl/Alt/Cmd, none on an auto-repeat, none for a button that
could not be pressed — and a clicked piece hands keys back to the table while a
tabbed-to piece keeps them, decided by the last `pointerdown` rather than by
`:focus-visible` (K4). The taunt picker is a key in the controls while somebody
else is acting (K5).

## Bots

For-fun tables only, and refused anywhere else: a bot has no account, so a game
won against one for chips would be chips out of thin air.

A bot knows its own hand and how many dice it cannot see. With wilds, each unseen
die matches a bid's plain face with probability `1/3`, and a bid on ones with
probability `1/6`. From that it has the probability the standing bid is good,
and:

- calls liar when that probability is low enough for its skill;
- otherwise raises, preferring a face it actually holds, at the smallest count it
  still believes;
- calls exact only when the standing count sits exactly on its own most likely
  total, and only at `hard`.

Skill moves the threshold and the thinking time, as Death Roll's does.

## Testing

`bid.ts` is where a rules bug would hide, so it is tested hardest: the four
arithmetic cases each way, the `ceil(Q/2)` even/odd boundary,
ones-outrank-at-equal, the ceiling, `minRaise` returning null when nothing is
legal, and a sweep asserting `beats` is a strict total order over every bid up to
fifty dice.

`round.ts` and `game.ts`: wild counting, a liar call both ways, exact right and
wrong, elimination, the opener moving to whoever lost the die and past them when
that put them out, and the invariant that no resolution can leave nobody holding
dice.

`adapter.ts`: Death Roll's money cases, ported — short antes, a throwing store, a
leave mid-ante, a leave during somebody else's refund, a void racing a settle,
fewer than two funded. Plus: a bot refused at a chips table, the clock bidding
the minimum rather than calling, and the clock calling only at the ceiling.

Client: the stylesheet tests jsdom cannot see (the one-screen shell rules,
container sizing, the inherited die size, reduced-motion coverage); a key test
per shortcut and per K3 exclusion, including the `:focus-visible` spy that proves
it is not what decides; `errorKey` bumped by a repeat and not by a dropped line;
activity lines added on new words and on the counter moving, not on an unchanged
broadcast; and a latency test proving the optimistic bid shows at a non-zero
round trip.

By hand: 375×560, 375×667, 375×812, 768×1024 and a desk, checking
`scrollWidth === clientWidth` and the main action visible without scrolling at
each (L8); a throttled connection for the busy state; a refusal over the blurred
board; talk opened on a phone.

Every bug found on the way gets a test watched failing against the old code
first.

## Wiring it in

- `apps/server/src/server.ts` — `.add(LIARS_DICE)` in the catalogue and the
  adapter in the map, with `roll` from `randomInt`.
- `apps/web/src/App.tsx` — `/liars-dice` and `/liars-dice/:code`.
- `apps/web/src/room/Room.tsx` — the theme import, so the tile is dressed.
- `apps/web/src/room/TileArt.tsx` — a `CupArt`: a dice cup tipped over dice.
- `apps/web/package.json`, `apps/server/package.json` — the workspace dep.
- `packages/core` — `Readiness` moved in and exported; Death Roll re-exports it.

## What this does not do

- **No palifico.** The real game gives a player down to one die a round where
  ones are not wild and the count cannot be raised. It is a good rule, and it is
  a second set of bid arithmetic, a second thing to explain behind the `?` key
  and a second thing for the picker to dim. Not in the first version.
- **No rebuy.** Out is out for the game; the pot is decided by who is left.
- **No spectator hands.** While bidding is running, somebody watching sees what a
  player who is out sees: counts, not faces. A watcher who could read every cup
  could tell a player. A reveal is public to everybody at the table, watchers
  included — that is what a reveal is.
- **No bank of any kind.** The pot is the antes. There is nothing here to fund.
