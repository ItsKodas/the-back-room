# The Back Room

A chips-only casino. Blackjack and Greed today, more later.

Everything below applies to every game in the building, not just the one you
are working on. A game that breaks one of these is wrong, however well it
plays.

## The money

### There is no real money here, ever

Players get chips daily and nowhere else, except from an admin: by a
redemption code they mint, or by a grant written into the admin log. Both
are the same power — chips nobody won — so both sit behind the same
allowlist, and neither is ever a thing a player can cause. Nothing in this
building takes payment, and nothing in it ever should. If a change would
create a route from money to chips, it is the wrong change.

### Chips are only won from real people

A player cannot come out of a hand richer unless real people were in it with
them. This is the line that keeps the economy from being a button somebody
holds down.

It follows that:

- **No bots at a table playing for chips.** Bots exist to make a for-fun table
  worth sitting at on your own. They are dealt in at play-money tables and
  refused at every other kind.
- **A chips game does not run for one player** unless it is playing against a
  bank on the terms below. Otherwise it waits: a table that cannot find a
  second real player does not deal; one that loses its second player pauses and
  says so rather than quietly carrying on paying out.
- **Waiting never costs anybody a stake.** Chips leave an account when they are
  put on the felt, so a table that holds must hold with the felt untouched.
  Clearing it to wait is the table keeping the money.
- **Play money never touches an account.** A for-fun table's purse lives at
  that table and is gone when it closes.

**Playing against the house is the one exception, and only on these terms.** A
game played alone against the house would otherwise be a button that mints
chips, so a game may run for one player *if and only if*:

- it pays from a bank that players alone fill, chip for chip, and every stake
  enters that bank before the game decides anything;
- it can never pay out more than the bank holds, and its stakes are capped so
  that this is arithmetically impossible rather than merely unlikely — the cap
  comes from the worst outcome the game can produce, not from a percentile;
- the only chips entering that bank from outside play are an admin's deliberate
  float, by the same authority that mints redemption codes;
- its outcomes come from a cryptographic source. A machine hands the player its
  whole result every round, which is exactly the run of observations needed to
  recover `Math.random`'s state and predict the next one;
- a round it gives away — a free spin, a respin, anything the player did not
  pay for — is still bound by all of the above, and by two more. It replays a
  bet the player actually put up rather than one chosen afterwards, or it is a
  way to be paid at a stake nobody staked. And its cap is re-derived from the
  bank each time: no stake enters on a free round, so the bank only shrinks
  under a run of them, and the bank at the eighth is not the bank that awarded
  it. A machine that cannot cover the rest of a run says so and stops.

A game dealt from a deck has one more condition, because its edge is thin
enough to be turned over: **it reshuffles every hand.** A machine's odds are
fixed by its strip whatever the player knows, but cards carried between hands
are cards that can be counted, and a counted shoe pays the player more than it
takes — out of a bank everybody else filled.

On those terms a win still comes from real people: everybody who played there
before you. Slots and blackjack are the two games in the building on this
footing, and each keeps **its own bank**. A shared one would be whichever game
holds back the most quietly paying for the one that holds back the least — the
machine keeps a tenth of what goes through it and a blackjack table about a
two-hundredth, so one bank would be the machine funding the felt. A third game
would have to earn all of this the same way.

### The server is the only authority

A game may ask the economy to move chips; it may not reach the store, and it
may not decide a balance. The client may *show* every rule above, but must
never be the thing enforcing one — anything a browser decides is something a
player can decide instead. Hiding a control is a courtesy; refusing the message
is the rule.

## How it should feel

### A press lands immediately, whatever the connection

Every move is a round trip, and a round trip is long enough for a button to
feel broken. Nothing waits for the server to acknowledge it before showing
something. Assume a bad connection: the person playing is not on localhost, and
a design that only works at zero latency is a design that has not been tested.

The bargain has one rule — **never invent a fact**:

- A number the player chose can be shown at once. A stake is theirs, so the
  chips go down on the press.
- A fact only the server knows cannot be. A card is not yours to guess, so what
  shows is a card arriving *face down*, and it turns over when the answer
  lands. One arrival, not two.
- Anything shown early is replaced the moment the table speaks, and given up on
  if it is refused or if the answer never comes.

Test this on a clock rather than by eye. On a machine talking to itself the
reply lands inside a frame, so a version that never worked at all looks perfect
right up until somebody plays from another continent.

### Everything that happens is animated, and the animation says what happened

Not decoration. Each one answers "what just changed?" without a word: a card
comes out of the shoe, a stake lands chip by chip, a total ticks because a card
arrived, a seat glows because it is waiting on you.

- **Motion is short and physical.** Things arrive from where they would come
  from and settle with a little overshoot. Nothing drifts, nothing bounces
  twice, nothing loops unless it is genuinely still happening.
- **One motion per thing.** Two animations fighting over one element is the
  bug, not the effect — if an element has to change identity mid-motion, the
  motion continues across the change.
- **Respect `prefers-reduced-motion`.** Every keyframe in the building has an
  off switch, and the page still says everything it needs to without them.
- **Sound follows the same rule.** Synthesised for the interface, sampled for
  physical things, quiet enough to live under twenty presses, and always
  under the player's own volume and mute.

### It works on a phone

Every page, every game, every control. A table gets played on a phone at least
as often as on a desk, and a felt that only lays out at 1200px is broken.

- Nothing scrolls sideways. Wide things — a long hand, a table of figures —
  scroll inside their own box or reflow.
- Controls are big enough to hit with a thumb, and the ones you use during a
  hand are within reach of one.
- Hover is not a way to reach anything. Anything hover reveals must be
  available without it.
- Check at 375px wide before calling something done.

### A table that deals itself

Games run on their own clock. Nobody presses start, a round comes round, and
players sit down and leave whenever they like. A table may ask whoever is
sitting down whether they are in, so long as its own clock deals anyway once
enough of them are — a ready button that one idle player can hold shut is a
table that has stopped dealing itself. A table closes when the last
player leaves it. The host sets the shape of the table when they open it —
seats, betting window, what it plays for — and those are decisions about
everybody's evening, so they are the host's rather than anybody's.

## How the work is done

- **Every bug fix gets a test that fails without it.** Not a test that passes
  afterwards — one that has been watched failing against the old code.
- **Flakes are bugs.** A test that fails one run in twenty is hiding something;
  find it rather than re-running.
- **Comments say why, not what.** The code already says what.

## Shape of the repo

```
packages/core      seating, table lifecycle, the GameAdapter interface
packages/economy   accounts, balances, the daily, redemption codes
packages/rules     dice scoring
packages/shared    the socket protocol and its zod schemas
packages/ui        design tokens and procedural textures
games/greed        six dice, bank it or lose it
games/blackjack    beat the dealer to twenty-one, from its own bank
games/slots        five reels, nine lines, its own bank
apps/server        express + socket.io, one game:action envelope
apps/web           react client
```

## Housekeeping

- `npm test`, `npm run typecheck`, `npm run lint` all have to be clean.
- Use `biome format --write <paths>` on the files you touched. **Not**
  `biome check --write` across the repo — it applies an import-ordering assist
  this project deliberately leaves off, and rewrites dozens of untouched files.
- **Check a stylesheet is imported before adding to it.** There have been
  orphan `.css` files in this repo that nothing loads; rules added to one are
  silently dead. `grep` for the filename first.
- `apps/web/public/audio/` is generated from `assets/audio/raw`; it is ignored.
