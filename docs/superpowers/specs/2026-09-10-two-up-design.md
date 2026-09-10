# Two-up

Two coins in the air. Heads or tails, and nothing in between.

Two-up has been a sign on a door since `packages/core/src/coming.ts` was
written — listed, coloured slate and silver, `minSeats: 1`, and shut. This
turns it into a door.

It is built as two schools sharing one toss, because two-up is genuinely two
games and building only one of them would be picking a side. The host chooses
which when they open the table, the way they already choose seats and the
betting window.

## The toss

One coin has two faces. Two coins have three outcomes, and every rule in this
document is a way of reading them:

| Throw | What it is |
| --- | --- |
| both heads | `heads` |
| both tails | `tails` |
| one of each | `odds` — no result |

`coins.ts` is the only module that touches randomness. It takes the server's
cryptographic source — the same `spinRandom` the reels, the shoe and the wheel
already take — and hands back an outcome. Both schools read what it says and
neither can ask it anything else. `Math.random` is refused here for the reason
CLAUDE.md gives: a table hands every watcher its whole result every throw,
which is exactly the run of observations needed to recover its state.

Odds is not a result. It is thrown again, up to five times in one round.

## The casino school — against the bank

### Playing

A timed betting window, the host's choice of fifteen, thirty or sixty seconds,
with a last call so a late chip is never a race. Three bets:

- **Heads** — pays 1:1
- **Tails** — pays 1:1
- **Five Odds** — pays 30:1

The window shuts and the coins go up. `heads` pays the heads money and takes
the tails money; `tails` does the reverse. `odds` is thrown again. Five odds in
a row and **both** heads and tails lose, and the five-odds bet comes in.

That one-in-thirty-two is the entire house edge, and it is the whole reason
this school can exist at all. Without it, heads at evens is a coin flip against
a bank, and a coin flip against a bank is a button that mints.

### The numbers

```
P(heads wins)  = (31/32) x 1/2 = 31/64      edge = 2/64 = 3.125%
P(five odds)   = (1/2)^5       = 1/32       fair price 31:1
```

Five Odds is paid at **30:1** rather than the 25:1 a real casino pays. At 30:1
its edge is `1 - 31/32 = 3.125%` — exactly the main bet's. The number is
therefore derived from the game rather than chosen, and a punter cannot find a
worse bet on this table by accident. It is the same argument the rest of the
building makes about caps: a figure a person can check beats a figure that
merely tested well.

An odds re-throw is **not** a free round under CLAUDE.md's clause. No new stake
enters, the same bet is still live, no additional payout becomes possible, and
the bank's exposure at the fifth throw is the exposure it already covered at
the first. Nothing needs re-deriving mid-round.

### The bank

Its own, never shared: `BANKS` gains `"two-up"`. Every stake enters it as the
chip lands and nothing leaves until the round settles, so the table can only
ever hand over what somebody put there.

The cap is exact and closed-form. Where `bank` is what the bank holds *not*
counting this round's chips, and `h`, `t`, `f` are what is on heads, tails and
five odds:

```
owed   = max( 2h, 2t, 31f )
needed = max( 0, owed - (h + t + f) )
```

and the most that can still go on each, solved rather than searched:

```
headroom(heads)     = max(0, bank + t + f - h)
headroom(tails)     = max(0, bank + h + f - t)
headroom(five odds) = max(0, floor( (bank + h + t - 30f) / 30 ))
```

Two consequences worth stating, because they are the point. Equal money on
heads and tails can never both come in, so between them they need no bank at
all and the table will take them all evening. And a bank of zero still takes a
hundred on heads against a hundred already on tails — which is a table that
works on its first night rather than one that greys out until an imaginary
bank has filled.

`STAKE_DIVISOR = 30`: the worst ratio a lone chip can produce, for the admin
bank route in `server.ts` that asks what a bank could take at all.

### Waiting

It does not have to. A bank behind the table is the exception CLAUDE.md names,
so one player against the house is a game between people who are simply not in
the room at the same time.

## The traditional school — against each other

No bank, and it must not have one: chips only ever move between the people in
the ring.

### Playing

The **spinner** is a named seat, and the kip passes round. A round is:

1. **Centre.** The spinner puts up a centre bet from their own chips.
2. **Covering.** The ring covers it — anybody else may put chips in, up to what
   is left uncovered. Whatever is still uncovered when the window shuts goes
   back to the spinner, and the contest is over the covered amount on each
   side.
3. **Spinning.** The spinner throws until one of three things happens:
   - **three heads** before any tails — the spinner takes the covered chips;
   - **tails** — the coverers take the spinner's stake, pro rata;
   - **five odds in a row** — the spinner is *odded out*. Every chip goes back
     where it came from and the kip passes.

Odds do not count towards the three. This is the come-in sequence a real school
plays, and it is why a school round is a run of throws rather than one.

### The chips

Taken as they are staked and paid as the round settles — direct, with no
poker-style stack in between. A partial cover is returned through `payOut`,
which is the unlatched per-item hook, so one return cannot swallow the one
behind it.

Multiple coverers share pro rata by what they put in.

### Waiting

This is the school the rule bites on, so the line is drawn explicitly rather
than left to fall out:

- Below two seated players during **centre** or **covering**, the table holds
  where it is. The felt is untouched — nothing is cleared, nobody's stake is
  taken back to wait — and the felt says why. This is CLAUDE.md's "a table that
  holds must hold with the felt untouched"; clearing to wait would be the table
  keeping the money.
- Below two seated players once the coins are already **in the air**, the round
  finishes. The chips on the felt were staked by two real people before the
  throw, and freezing a thrown coin is a worse answer than paying out one that
  landed.

A for-fun table waits for nobody, because its purse was never anybody's.

The listing keeps `minSeats: 1` regardless. A listing says what a *game*
allows, and this game allows one player at a casino table — the same
distinction `PlayTable.maxSeats` already documents about sizes. The traditional
school's need for company is a rule of that school, enforced by the table,
which is the only place it can be enforced honestly: the room cannot know which
ruleset a host is about to pick.

## Both schools

### Phases

```
casino:  betting ─────────────┐        ┌── odds ──────────────┐
school:  centre → covering ───┴→ kip → spinning → reading ────┤
                                  ↑                           │
                                  └──── odds (school only) ────┤
                                                               │
                                             settled ←─────────┘
                                                │
                                                └→ (round again)
```

`kip` is the beat between the window shutting and the coins leaving. Both
schools have it, and it is where the spinner exists: the seat is named and lit,
and the throw happens on their press or on the clock running out.

`reading` is a real phase too. Odds is the moment the ring groans, and a state
that went straight from `spinning` back to `spinning` would swallow it.

The two schools differ in where an odds throw returns to, and the difference is
exactly the difference between the spinners:

- **Casino** returns to `spinning`. The spinner is ceremonial, they pressed once
  for the round, and the boxer simply throws again.
- **School** returns to `kip`. The spinner is the game, and throwing again is
  their move to make.

The adapter's `pause` key carries the throw index, for the reason the `pause`
documentation gives: without it the server cannot tell "already scheduled" from
"scheduled for something that is no longer happening", and the fourth throw's
wait would be mistaken for the third's.

### The board

A strip of recent results beside the ring, newest last, the way the wheel has
one. Two-up players track runs whether or not a run means anything, and a game
whose whole content is a sequence of three symbols is one where the sequence is
most of what there is to look at. Heads, tails and odds all go on it — an odds
throw is not a result but it is emphatically something that happened, and a
board that hid them would misreport an evening where the coins came down split
nine times running.

### The spinner

Ceremonial in the casino school, real in the traditional one.

Casino: the seat is named, it rotates each round, and whoever holds it may
press the kip once the window shuts. If they do not press it before the clock
runs out, the boxer throws for them. The table never stalls, and the money does
not care who held the kip.

School: the spinner is the game. They set the centre, they throw, and the kip
passes on a tails or on being odded out.

### Bots

Refused at any table playing for chips, in either school. Dealt in at a for-fun
table, which is what they are for.

### Play money

A for-fun table's purse and bank live at the table and are gone when it closes.
A signed-in player at a for-fun table spends the purse and not their chips; the
adapter branches on `forFun` for every movement, because the branch that gets
this wrong spends a real balance.

## The package

`games/two-up`, at roulette's granularity so that no one file carries two
schools:

```
src/coins.ts    the toss, and the only thing here that touches randomness
src/casino.ts   the casino school reading a run of tosses
src/school.ts   the traditional school reading the same run
src/bank.ts     owed / needed / headroom; FIVE_ODDS_PAYS; the chip levels
src/centre.ts   the centre bet and covering it
src/table.ts    seats, phases, the view; knows its school, delegates the round
src/adapter.ts  create / act / settle / payOut / winners / pause / botMove
src/bot.ts      for-fun bots only
src/listing.ts  how it lists itself in the room
src/theme.css   the coin room
src/index.ts    the barrel
```

The seam that keeps the split thin is `coins.ts`: one toss, two readers.

## The protocol

Nothing new. `actionSchema` is `{ type }` with a catch-all, and `createSchema`
already carries `ruleset`, `window`, `forFun` and `maxSeats`. The host's choice
of school is `ruleset: "casino" | "school"`, checked by the game rather than by
whoever passed it along — which is how Greed's rulesets already arrive.

Actions: `place` / `take` / `undo` / `clear` / `repeat` in the casino school,
mirroring roulette; `centre` / `cover` in the traditional one. `throw` belongs
to both — it is the kip press, and the only action either school's spinner has.
It is refused from any seat that is not holding the kip, and refused outside
the `kip` phase, because a client that can throw early is a client that can
throw twice.

## The felt

### The camera

We watch from the felt's own height, and the camera goes up with the coins.

Not a real 3D camera. The felt layer takes a `scale()`, a `translateY()` and a
brightness and blur ease as the coins rise, and comes back as they fall. Peak
recession is about twelve percent and half brightness: the ring stays plainly
in frame, plainly behind, and plainly not the thing being looked at. Other
people's bets are half the reason to watch this table and they never leave the
screen.

It costs no layout, which is what keeps it honest at 375px.

### The coins

`preserve-3d`, two faces, and a real milled edge built as a ring of about
twenty thin segments. The edge is what separates a coin from a flipping card,
and it costs forty elements for the pair. They tumble end-over-end on
`rotateX`, the way a thrown coin does, each with a small independent `rotateZ`
drift so the pair never reads as one rigid object.

They land on the face the server chose:

```
total rotation = turns x 360deg + (tails ? 180deg : 0)
```

with a different integer `turns` per coin, written as `calc()` for the reason
the wheel writes its angles that way: two separately-rounded decimals
subtracted is how "a whole number of turns" quietly stops being true.

### Three profiles, one file

`apps/web/src/twoup/toss.ts` does for the toss what `roulette/spin.ts` does for
the wheel. Each profile is exported both as a `linear()` easing for the
stylesheet and as event times for the sound, so the two cannot drift:

- **Flight** — ballistic. Up fast, hang at the apex, down accelerating. The
  hang is the whole feeling; it is what a real ring is shouting through.
- **Spin** — near-constant angular velocity in the air. A coin does not slow
  down mid-flight, and easing the rotation out is what makes an animation of
  one feel fake.
- **Wobble** — the landing. One small bounce, then flat, then the rim describes
  a cone with **decaying amplitude and rising frequency**. A settling disc's
  precession accelerates, which is counter-intuitive and is the single most
  satisfying second of a coin flip.

### Never invent a fact

The kip swing is the player's own press, so it fires on the press. The faces
are the server's, so the coins go up **edge-on and blank** and resolve on the
way down, when the answer has landed. One arrival, not two.

Tested on a clock rather than by eye. On a machine talking to itself the reply
lands inside a frame, and a version that never worked at all looks perfect
right up until somebody plays from another continent.

### Reduced motion

No push, no tumble. The coins cross-fade to their final faces over about three
hundred milliseconds, and the result lands at exactly the same moment, so the
sound, the felt and the text stay in step.

### A phone

375px first. Bets sit in a bottom rail within reach of one thumb; the coins own
the middle; the school's centre and cover controls are the same rail. Nothing
is reachable only by hover. Nothing scrolls sideways.

## The sound

Scheduled against the same profile times the animation uses, from one call at
the moment the coins leave the kip — the pattern `useSpinSound` established,
for the reason it gives: triggered separately, the two can only drift, and the
first thing a listener notices is a clatter that does not land with what they
are watching.

- **kip** — a wooden whoosh as the paddle swings.
- **ring** — two detuned metallic tones with inharmonic partials, panned
  slightly apart. The coins in the air.
- **clack** ×2 — two separate impacts, a beat apart, from the landing times.
- **rattle** — the wobble, as an impulse train whose rate rides the same wobble
  curve the animation does, dying to nothing.
- **heads / tails / odds** — the boxer's call, once the coins are read.

Synthesised, because there is nothing to sample. But `scripts/sync-audio.mjs`
gains a `coins` group, and `assets/audio/raw/coins/` gains a drop zone and a
line in the README, so the day real pennies-on-wood land there they take the
impacts over with no code change. Synthesised for the interface, sampled for
physical things — as soon as there is anything to sample.

## The assets

Procedural, the way the wheel is, so they are legible at forty pixels on a tile
and at four hundred on a desk.

1. **The penny** — struck metal rather than flat silhouette: a relief head one
   side, a kangaroo the other, lit from a fixed direction.
2. **The chalk cross** — a real school chalks a white X on the tails face so
   the ring can read a throw from across the room. It is authentic, and it is
   what lets a player read the result at the top of the arc before the coins
   are down, which is the one problem a cinematic toss has.
3. **The kip** — the flat wooden paddle, side-on, that the coins leave from.
4. **The ring** — a chalked circle on boards, for the traditional school.
5. **The room tile** — two coins mid-tumble, in `TileArt.tsx`.
6. **The link card motif** — the same pair, in `og.ts`.
7. **A gallery mockup** — `TwoUpMockup.tsx`, beside the other three.

## Where it has to be announced

Measured by tracing every place roulette appears outside its own package:

- `packages/economy/src/store.ts` — `BANKS` gains `"two-up"`
- `packages/core/src/coming.ts` — two-up moves **out**; it is a door now
- `apps/server/src/server.ts` — the catalogue, `ADAPTERS`, `capOf`
- `apps/server/src/og.ts` — the link-card motif
- `apps/web/src/App.tsx` — the routes
- `apps/web/src/room/Room.tsx` — the theme import
- `apps/web/src/room/TileArt.tsx` — the room tile
- `apps/web/vite.config.ts` — `optimizeDeps.exclude`; the comment there records
  that omitting a game cost two rounds of debugging a blank page
- `apps/web/src/style/Gallery.tsx` — the mockup
- `scripts/sync-audio.mjs` — the `coins` group

One window per game comes free: it is keyed on the game id server-side.

## Testing

Every bug fix gets a test that fails without it, and these get written first:

- **The bank cannot be asked for more than it holds.** Exhaustive over the
  outcome space — heads, tails and a five-odds bet sitting alongside each
  other — asserting `owed <= bank + staked` after every accepted chip, and that
  `headroom` is exactly the largest chip that keeps it true.
- **Equal money needs no bank.** A bank of zero takes a hundred on heads
  against a hundred on tails, and refuses the hundred-and-first.
- **Five odds pays and everything else loses.** A forced run of five odds.
- **A school table with one player holds with the felt untouched.** The rule
  easiest to break by accident: assert the centre is still there and that
  nobody has been paid or refunded.
- **Odds does not count towards three heads.**
- **The coin lands on the face the server chose** — the rotation the felt is
  given resolves to the outcome, for both faces and both coins.
- **The toss is timed, not eyeballed.** The kip responds on the press and the
  faces only after the answer lands, asserted against a delayed reply rather
  than an immediate one.
- **Bots are refused at a chips table** in both schools.

## Deliberately not built

**Matched side bets around the ring — ringies.** The authentic thing is a
shouted order book between individual punters, and modelled digitally that is a
matching engine wearing a game's clothes. The centre bet is the heart of
two-up and it is a complete game without them. Named here rather than left
missing, because it is the obvious next thing somebody will want.
