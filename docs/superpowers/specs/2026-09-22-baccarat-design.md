# Baccarat — design

Player or Banker, and which of them gets closer to nine. Everybody at the
table bets into one window, one coup answers all of them, and nobody has a
turn — because in baccarat nobody has a decision. The tableau is fixed. What a
player does here is choose a side and how much.

It is the sixth game in the building to pay from a bank, and the third dealt
from a deck.

## Why it can exist

CLAUDE.md allows a game to run for one player *only* against a bank, on named
terms, and says a sixth game "would have to earn all of this the same way".
Baccarat takes the footing whole:

- **A bank players alone fill.** `"baccarat"` joins `BANKS`. Every stake is in
  it before the coup is decided, and every payout comes out of it.
- **A cap from the worst outcome, arithmetically.** Not a percentile — the
  exact exposure across the whole cloth, worked out over three outcomes. See
  [The cap](#the-cap).
- **Chips from outside only by an admin's float**, through the same route and
  the same allowlist as every other bank.
- **A cryptographic source.** The shuffle comes from the server's `spinRandom`,
  the same `node:crypto` source the reels, the shoe and the wheel take. A table
  hands every watcher every card it deals, which over an evening is exactly the
  run of observations needed to recover `Math.random`'s state.
- **No free rounds.** Baccarat has none, so that clause never comes into play.

And the extra condition on a game dealt from a deck: **it reshuffles every
coup**. See [The shoe](#the-shoe).

It keeps **its own bank**. Baccarat holds back about 1.2% of what goes through
it — above blackjack's half a percent, well below the machine's tenth — and a
shared bank would be one of those games quietly paying for another.

## The shape of the table

Roulette's, not blackjack's, and that is the whole architectural claim of this
document. A blackjack table waits on a person: whose turn, what they chose,
a clock that runs out. A baccarat table waits on nothing but its own clock,
because once the bets are in there is no decision left to make. So it is three
timed phases going round, exactly as the wheel is:

```
betting ──(window shuts)──> dealing ──(coup revealed)──> settled ──> betting
```

- **betting** — the host's window: 15, 30 or 60 seconds. Last call at
  `min(5s, window / 3)`, so a short window never opens already shut.
- **dealing** — the coup, revealed on a schedule. Its length comes from the
  coup itself: a natural finishes in about three seconds, a full tableau in
  about five.
- **settled** — six seconds to read, then the cloth is swept.

**An empty cloth does not deal.** The window reopens with the felt untouched.
A stream of results nobody bet on is noise, and clearing the felt to wait
would be the table keeping the money — CLAUDE.md, "waiting never costs
anybody a stake".

### Seats

One to eight, as the listing waiting in `COMING` already says. One is allowed
for the same reason the wheel and the machine allow it: this table pays from a
bank that players alone fill, so a win still comes from real people —
everybody who played here before you. What it is not allowed to do is seat a
bot at a table playing for chips, which `addBot` refuses. The host picks the
table's size when they open it, with the rest of its shape.

`leavesMidHand = true`, for roulette's reason: nothing is kept from a seat
that stands up. Chips down while bets are open come back unless another bet
is leaning on them; chips that ride are paid to the account whatever the coup
does. Holding the seat would be holding it for nothing.

## The shoe

Eight decks, Fisher-Yates from injected randomness, **reshuffled before every
coup**.

Eight decks rather than one because that is the distribution the real game is
played on, and the tableau's probabilities are quoted against it. Reshuffled
every coup because CLAUDE.md leaves no room: "cards carried between hands are
cards that can be counted, and a counted shoe pays the player more than it
takes — out of a bank everybody else filled."

The practical effect is that the bead plate predicts nothing. It already
predicted nothing at a real table; here it cannot even pretend to. It stays
because it is the game's furniture and because roulette's history strip is the
same honest decoration.

## The tableau

Card values: ace is 1, two through nine are themselves, ten and the court are
0. A hand's total is the sum modulo 10.

Dealt Player, Banker, Player, Banker.

**Natural.** If either side totals 8 or 9 on two cards, both stand and the coup
is over.

**Player's rule.** Otherwise Player draws a third card on 0–5 and stands on
6–7.

**Banker's rule.** If Player stood, Banker draws on 0–5 and stands on 6–7. If
Player drew a third card of value `v`:

| Banker total | Draws when |
|---|---|
| 0, 1, 2 | always |
| 3 | `v ≠ 8` |
| 4 | `v` in 2–7 |
| 5 | `v` in 4–7 |
| 6 | `v` in 6–7 |
| 7 | never |

Higher final total wins. Equal totals are a tie.

This table is where baccarat implementations go wrong, so every row of it gets
its own test — all ten Banker totals against all ten third-card values, plus
the stood-player branch and both natural branches.

## The bets

Three spots. Player, Banker, Tie. No pair bets: they would add an 11:1 line to
the bank's worst case, shrink everybody's headroom, and crowd a cloth that has
to work under a thumb at 375px.

What comes back, per chip staked:

| spot \ outcome | Player wins | Banker wins | Tie |
|---|---|---|---|
| **Player** | 2× | 0 | 1× (push) |
| **Banker** | 0 | 2× − commission | 1× (push) |
| **Tie** | 0 | 0 | 9× |

Ties push the two side bets rather than taking them. That is the standard rule
and it matters to the arithmetic below: on the tie outcome, Player and Banker
money is owed back in full.

### Commission

A winning Banker bet pays 1:1 less 5%, **rounded up to a whole chip**:

```
back = 2 × stake − ceil(stake / 20)
```

Chips are integers and 5% of the smallest chip in the tray is 1.25, so the
commission has to round somewhere. It rounds up so the house's edge can never
round away: a commission that floored would thin the edge at small stakes, and
the whole justification for this table paying one player at all is that the
bank is never the loser in the long run.

The cost falls only on the smallest bets, because commission is charged on the
total on the spot rather than per chip — a player stacking chips on Banker is
charged once on the pile. A 25 pays 8%, a 50 pays 6%, a 100 pays exactly 5%,
and from there up nothing is more than a fifth of a percent off it.

### The house's side of it

Against an eight-deck shoe: Banker wins 45.86%, Player 44.62%, tie 9.52%. That
gives Banker an edge of about 1.06% at a true 5% commission, Player 1.24%, and
Tie at 8:1 about 14.4%.

Tie is a bad bet and the felt does not pretend otherwise — it is the spot that
pays 8:1, which is what a player is buying. What the table will not do is hide
it behind a nicer-looking number.

## The cap

**Worked out across the whole cloth, exactly, every time a chip goes down.**

One coup settles everybody, so a cap derived per seat would be a promise about
one player made in front of eight. This is the argument `games/roulette/src/bank.ts`
already makes over thirty-seven pockets; here there are three outcomes, so the
same method costs almost nothing.

```
owed(bets)   = max over outcome of Σ back(bet, outcome)
staked(bets) = Σ bet.chips
needed(bets) = max(0, owed − staked)
```

It buys the same generosity it buys the wheel. Equal chips on Player and
Banker cancel in every outcome — Player pays 2× and Banker 0, Banker pays just
under 2× and Player 0, a tie returns both — so **matched money needs no bank at
all**, and a table that understands that takes bets all evening that a cruder
one would refuse.

`STAKE_DIVISOR = 8`: the worst a lone chip can do is Tie at 8:1. That is the
figure `capOf` reports for the admin desk's "what could this bank take at all".

### headroom, and why it bisects

The most that can still go on one spot, given what is already down. For a spot
`s` and every outcome `o`:

```
already(o) + back(s, x, o) ≤ bank + staked + x
```

Roulette solves its version algebraically, because every payout there is a
whole multiple of the stake. Here the Banker line is `2x − ceil(x/20)`, which
is **not linear in x** — the commission steps. Dividing through would either
over-promise or quietly under-serve the player by up to 5%.

So it is solved by bisection instead, and what makes bisection exact rather
than approximate needs stating carefully, because the obvious version of the
argument is wrong.

`back(s, x, o) − x` is **not** monotone across the board. For the outcome the
spot wins on it rises with `x`; for an outcome the spot loses on it is
`already(o) − x`, which *falls*. So the set of stakes the bank can cover is an
interval `[lo, hi]` rather than a prefix, and bisecting it blind would find
nothing.

What rescues it is that `lo` is always nought on any cloth this table could
actually have built. `fits(0)` is true exactly when `owed(cloth) ≤ bank +
staked(cloth)` — which is to say exactly when the bank already covers the
cloth as it stands, which is the invariant every chip is admitted under. So on
a live cloth the interval starts at nought, the feasible set *is* a prefix,
and bisection is exact.

When `fits(0)` is false the cloth is over-committed — which happens for real,
because every baccarat table shares one bank and another table's payout can
take it below what this cloth already needs. The honest answer then is nought:
the interior band does exist (with a thousand on Player and an empty bank, a
thousand or more on Banker would technically balance the books, because Banker
money is what Player money is paid out of), but offering it would be the table
telling a player they must stake a minimum in order to rescue the house's
shortfall. It refuses instead and lets the cloth settle on its own.

About two dozen iterations, and a cap that is arithmetic rather than nearly
right.

The bank goes into that inequality as it is, **never clamped up to nought
first** — roulette's comment explains why, and the reason carries: the bank is
shared across every baccarat table, so another table's payout can take it
below this cloth's own stakes. Only the result is floored, which makes an
overdrawn bank offer nothing, the honest answer.

### Against the ledger

Every baccarat table in the building is paid from one bank, so the cap is
measured against the bank **less everything every other table could still owe**,
through `ledgerOf(bank)` and `BankLedger.serially`. Straight from roulette's
adapter, for the reason `BankLedger` documents: a cap is only a fact if nothing
moves between reading the bank and the chip landing.

## How the coup reaches the table

**One broadcast, and a schedule both sides share.**

The whole coup is decided when betting closes and travels in the view, the way
the wheel's pocket rides in the payload for the entire spin. The client does
not show what it has not been given permission to show yet.

Streaming the coup card by card was rejected. It would make every card's
animation wait on a round trip, which is precisely the design CLAUDE.md says
has only ever been tested on localhost — six broadcasts a coup, and a player on
another continent watches a stuttering deal.

Nothing here has to be guessed optimistically, because no press deals a card.
The "never invent a fact" bargain applies to the chips instead: a stake is a
number the player chose, so it goes down on the press; the coup is the table's
and waits for the table.

What the client owes the player is the ceremony, and that comes from
`schedule(coup)` — exported from the game package so the server's phase length
and the client's animation cannot drift:

| moment | ms |
|---|---|
| four cards out, face down | 0, 320, 640, 960 |
| Player's pair turns | 1500 |
| Banker's pair turns | 2150 |
| Player's third out / turns | 2900 / 3320 |
| Banker's third out / turns | 3700 / 4120 (2900 / 3320 if Player stood) |
| hold before settling | last turn + 1000 |

A natural runs about 3.2 seconds, a full tableau about 5.1. The phase length is
the schedule's total, so the table never pads a quick coup to a fixed length.

The view carries the **whole** coup for the whole of the dealing phase, third
cards included, and the client works out where in the reveal it is from the
phase deadline:

```
elapsed = now − (deadline − schedule.total)
```

Which is what makes a reconnect land on the right card rather than replaying
the deal from the start, and why the schedule has to be one function rather
than a constant on each side.

### What the view carries

The coup, the phase and its deadline, every chip on the cloth, what the last
coup paid by seat, the bead plate, the winners board, the seats, and **what the
bank holds**. That last is a display figure only — it lets the felt grey out a
spot the bank cannot cover, rather than letting somebody find the cap by being
refused. Every bet is checked again on the way in, because a number a browser
has been told is a number a browser can change.

## The package — `games/baccarat/`

Following the shape every other game uses.

| file | what it holds |
|---|---|
| `cards.ts` | Eight decks, Fisher-Yates from injected randomness, reshuffled every coup |
| `coup.ts` | The tableau. Values, totals, both draw rules, the outcome |
| `spots.ts` | The three spots and their returns |
| `bank.ts` | `CHIPS`, `MIN_CHIP`, `staked`/`owed`/`needed`/`headroom`, `STAKE_DIVISOR`, `FUN_PURSE`, `FUN_BANK` |
| `bets.ts` | `Placed`, `Paid`, `settle` |
| `schedule.ts` | The reveal timing, shared by server and client |
| `bot.ts` | Bot bets, for-fun tables only |
| `table.ts` | The three phases, escrow, purses, bead plate, winners, `addBot` |
| `adapter.ts` | The `GameAdapter`: bank, ledger, `serially`, leavers, settlement |
| `listing.ts` | `BACCARAT`, moved out of `COMING` with `open: true` |
| `index.ts`, `theme.css`, `package.json` | |

Constants match the rest of the floor: the house chip set, `WINDOWS` of 15/30/60
seconds, `FUN_PURSE` 25,000, `FUN_BANK` 2,000,000, `SETTLE_MS` 6,000,
`WINNERS` 6. `HISTORY` is 36 — six rows of six, which is what a bead plate is.

`addBot` refuses at a chips table, the way blackjack's does. Bots exist to make
a for-fun table worth sitting at alone; a bot has no account to charge and none
to pay, so a coup won against one for chips is chips out of thin air.

## The client — `apps/web/src/baccarat/`

| file | what it draws |
|---|---|
| `Baccarat.tsx` | The page: lobby, felt, seats, chat |
| `Cloth.tsx` | Three spots, the chips on them, place and take-back |
| `Coup.tsx` | The two hands and their totals |
| `BeadPlate.tsx` | Recent results, six rows, filling column by column |
| `Winners.tsx` | Who has been paid lately |
| `reveal.ts` | Driving `schedule(coup)` against the phase deadline |
| `useCoupSound.ts` | Card sounds, from what `audio.ts` already has |
| `baccarat.css` | |

Three spots instead of roulette's thirty-seven numbers, which makes the phone
case easy rather than a fight: three thumb-sized targets, no hover to reach
anything, nothing scrolling sideways. The bead plate scrolls **inside its own
box** when it is wider than the screen. Checked at 375px before it is called
done.

Right-click or press-and-hold takes a chip back, matching the wheel — somebody
who has learned it at one table should not learn it again across the room.

### Motion

Each animation answers "what just changed?":

- A card slides out of the shoe face down, and **turns over in place** — one
  motion per card, continuing across the change of identity rather than
  restarting.
- A total ticks because a card arrived, not on a timer.
- A stake lands chip by chip on the press.
- The winning spot lights when the coup settles, never before — a lit spot is
  the answer, several seconds early.

Short and physical, settling with a little overshoot. Every keyframe behind
`prefers-reduced-motion`, and the table says everything it needs to without
them.

## The shared deck

`apps/web/src/blackjack/Cards.tsx`, `deck.ts` and the card block of
`blackjack.css` move to `apps/web/src/cards/`. The `bj-card` prefix becomes a
neutral one, and blackjack imports from the new home.

One deck in the building. A second drawing of the same fifty-two cards is two
things to keep in step forever, and they would drift.

**This is the riskiest change on the branch** — it touches 1,686 lines of
blackjack stylesheet and its test suite. It lands as its own commit, with
blackjack's tests green, before baccarat imports anything from it.

## Wiring

Adding a game is exactly when nobody is thinking about the plumbing, which is
why `packaging.test.ts` and `catalogue.test.ts` exist. The full list:

**Server and packages**
- `packages/economy/src/store.ts` — `"baccarat"` in `BANKS`
- `packages/core/src/coming.ts` — the baccarat entry removed
- `apps/server/src/server.ts` — `baccaratBank`, the adapter registered with the
  crypto shuffle, `.add(BACCARAT)` on the catalogue, `emptyOneBank` and `capOf`
  cases
- `apps/server/src/og.ts` — card art for the link preview
- `apps/server/src/meta.ts` — the house-games sentence names baccarat
- `apps/server/package.json` — the dependency
- `Dockerfile` — `COPY games/baccarat/package.json` in **both** stages
- `apps/server/src/catalogue.test.ts` — `BACCARAT` in `BUILT`

**Web**
- `apps/web/src/App.tsx` — `/baccarat` and `/baccarat/:code`
- `apps/web/src/room/Room.tsx` — the theme import
- `apps/web/src/room/TileArt.tsx` — the room tile's art
- `apps/web/src/admin/Banks.tsx` — a row, `per: "a tie chip"`
- `apps/web/vite.config.ts` — `optimizeDeps.exclude`
- `apps/web/package.json` — the dependency

Theme, from the listing that has been waiting in `COMING`: wall `#12161c`,
felt `#1b2a3d`, accent `#3d7ab8`, accentHi `#86c2ff`. Blue, so it reads apart
from the wheel's red and the card room's green. `theme.css` and the listing
have to agree — the link cards are drawn on the server where there is no
stylesheet to read.

## Testing

Every bug fix gets a test that has been watched failing. Every piece of this
gets one before it is written.

**The rules**
- The Banker third-card table, exhaustively: every total against every third
  card value, plus the stood-player branch.
- Both naturals, on each side, including a natural against a natural.
- Card values, totals modulo 10, ties.
- The shoe is a fresh shuffle every coup — asserted, because it is a house rule
  and not an implementation detail.

**The money**
- Commission at every chip in the tray, and that rounding up never inverts the
  edge.
- `owed`/`needed` against a hand-checked cloth for each of the three outcomes.
- `headroom` is exact: the chip it offers is coverable, and one more is not.
- Matched Player/Banker money needs no bank.
- A negative bank offers nothing and traps nobody's chips.
- Two tables on one bank cannot both promise the same chips.

**The table**
- An empty cloth does not deal, and the felt is not swept to wait.
- A leaver's chips come back unless they are covering another bet, and ride
  once the window has shut.
- A voided table hands every chip back through the bank.
- Play money never touches an account — a signed-in player at a for-fun table
  spends the table's purse.
- Bots are refused at a chips table.

**The client**
- The reveal schedule against the phase deadline, including a reconnect
  landing mid-coup.
- The result is not on screen before the coup settles.
- Stylesheet tests for 375px and for `prefers-reduced-motion`, as blackjack and
  the wheel already have.

## Not in this

- Pair and perfect-pair side bets.
- The derived roads — big road, big eye boy, small road, cockroach pig. The
  bead plate is the one board worth drawing when the shoe is reshuffled every
  coup.
- A squeeze the player controls. It is the game's best piece of theatre and it
  is a decision-shaped thing at a table that has no decisions; it would need
  its own clock and its own answer to what happens when somebody walks away
  mid-squeeze.
