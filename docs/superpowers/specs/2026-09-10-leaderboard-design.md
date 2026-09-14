# The Leaderboard — design

A board of who is ahead, reachable from the front door. Every player, what
they hold, and enough beside it to argue about.

## The rule this breaks, on purpose

`PublicPlayer` has one sentence of doctrine attached to it, and it is blunt:

> What is not here is the point of it: no balance, no Discord id, no stats.
> Enough to recognise a person you meant to pay and no more.

A leaderboard is the opposite of that. It exists to publish balances.

So this is a deliberate exception rather than a quiet erosion of the rule, and
it is written down here and in a comment on the route that serves it. What
keeps the exception narrow:

- **It is behind a sign-in.** Somebody who has not walked into the building
  cannot read the playerbase off the front page. This matches `/api/players`,
  which is behind a sign-in for the same reason: it is a route that answers
  questions about people who are not asking.
- **It returns the board's columns and nothing else.** No Discord id, no
  daily-claim time, no jar, no per-game figures. A row is what the board
  prints.
- **`PublicPlayer` itself does not change.** Paying somebody still tells you
  nothing about what they hold. The leaderboard has its own row type, so no
  existing caller quietly starts receiving balances.

## The figures

Everything the board prints already exists but one. A balance is on the
profile; `ProfileStats` keeps `games`, `wins` and `chipsWon` — and `chipsWon`
is a **net**, which can be and often is negative. Losses and win rate come out
of `games` and `wins` by arithmetic.

The one that is missing does not exist anywhere, and is the only new data in
this design.

### `chipsStaked`

**Chips the player has put on the felt**, summed across every game that plays
for chips. Not "chips lost" — the amount wagered, win or lose. Somebody who
turns over a million chips and finishes level has done something worth showing,
and `chipsWon` alone says they did nothing at all.

It joins `ProfileStats` beside the other three:

```ts
export interface ProfileStats {
  games: number;
  wins: number;
  chipsWon: number;
  /** Chips put on the felt, win or lose. A free round stakes nothing. */
  chipsStaked: number;
}
```

Every game already writes a `shared` bump at the end of a hand with the two
numbers it needs to compute the net. The stake is the left-hand side of that
subtraction, so in every case it is a figure the adapter is already holding:

| game | `chipsWon` today | `chipsStaked` |
|---|---|---|
| greed | `seat.got - buyIn` | `buyIn` |
| blackjack | `seat.back - seat.out` | `seat.out` |
| roulette | `paid.back - paid.staked` | `paid.staked` |
| slots | `won - cost` | `cost` |
| death roll | `duel.netFor(seat)` | `duel.ante + duel.spentBy(seat)` |
| the tip jar | *(writes no `shared` bump)* | *(nothing)* |
| poker | *(writes no `shared` bump)* | *(nothing)* |

No new call sites, no new plumbing, and no new judgement about what counts as
a stake — each game is already deciding that, once, in the line above.

Three things fall out of this for free, which is the argument for putting it
here rather than anywhere else:

- **A free spin stakes nothing.** Slots already sets `cost` to zero on a free
  round, precisely so the wall does not advertise chips nobody put down. The
  board inherits that.
- **Play money never counts.** Greed skips the bump entirely unless
  `forChips`, and roulette skips it for a for-fun table. A play-money purse
  never touched an account and must not appear on a board of accounts.
- **Bots and guests never appear.** Neither has a profile, and the bump is
  keyed by `userId`. Nothing has to filter them out, because nothing ever
  wrote a row for them.

The tip jar stays out. It writes no `shared` bump today, with a comment saying
`games`/`wins`/`chipsWon` are about playing against somebody. A tap is not a
stake and tipping is not wagering.

**Poker is out too, and that one is an omission rather than a decision.** It
plays for chips — an entry stake and a buy-in — but its adapter calls
`deps.record` nowhere, so it has never written `games`, `wins` or `chipsWon`
either. This board does not cause that; it makes it visible, because a poker
regular now appears in public with nothing against their name. Fixing it means
deciding what a poker "game" and a poker "win" are and then changing what every
existing player's record means, which is a larger decision than a leaderboard
and belongs to whoever owns the game rather than to this design.

### What it costs to be honest about it

**The counter starts at zero for everybody.** Nothing recorded what anyone
staked before it existed, and it cannot be reconstructed: `GameRecord` holds
buy-ins for the table games but slots and the jar write no records at all, so
a backfill would silently undercount exactly the game that turns over the most
chips. A wrong number that looks right is worse than a young one.

So the column carries its age on the page: a note under the board saying
staking has only been counted since this shipped. It says so until it stops
being true, and then somebody deletes the line.

### Old accounts

`emptyStats()` gains `chipsStaked: 0`, and the Mongo `statsSchema` gains
`chipsStaked: { type: Number, default: 0 }`. Documents written before today
have no such field; Mongoose reads the default, and `bumpStats` uses `$inc`,
which treats a missing field as zero. Nothing needs migrating. There is a test
for exactly this, because "reads as zero" is an assumption about a driver
rather than about our own code.

## The store

One method, because a rank is not a property of a row — it is that row's
position in the whole collection, and the viewer's rank has to be answered by
the same query that answered everything else.

```ts
export type LeaderSort = "chips" | "net" | "staked" | "games" | "wins";

export interface LeaderRow {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  stats: ProfileStats;
}

leaderboard(input: {
  sort: LeaderSort;
  limit: number;
  /** The viewer, so their own standing comes back with the page. */
  you: string | null;
}): Promise<{
  rows: LeaderRow[];
  /** The viewer's row and rank, wherever they are. Null if not signed in. */
  you: { row: LeaderRow; rank: number } | null;
  total: number;
}>;
```

**Ranking.** A rank is one plus the number of accounts strictly ahead of you on
the sorted field. Ties therefore share a rank — three players on 10,000 chips
are all 4th, and the next is 7th. This is the ranking people expect from a
scoreboard, and it is the only one that does not depend on which of two equal
players the database happened to return first.

**Stability.** `_id` is the secondary sort. Without it two accounts with equal
chips can swap places between one poll and the next, and the page would animate
a reorder that did not happen.

**Mongo.** `find().sort(...).limit(...)` for the page; `countDocuments` on
"strictly ahead" for the viewer's rank; `estimatedDocumentCount` for the total.
Indexes on `chips`, `stats.chipsWon`, `stats.chipsStaked`, `stats.games` and
`stats.wins` — one per sortable column, descending.

**Memory store.** The same, done by sorting the map's values. It is the
no-database mode and the test double, so it must agree with Mongo on ties and
on ordering, and the ordering tests run against both.

### Win rate is shown but not sorted by

A rate is a ratio of two stored numbers, so sorting by it means either an
aggregation over the whole collection or an index that cannot exist. That is
the small objection. The real one: a player with a single lucky hand sits at
100% forever, and a board sorted that way is a board of people who have
played once. Every row prints its win rate; no header sorts by it. If it is
ever wanted, the way to add it is a minimum-games floor, not an index.

## The route

```
GET /api/leaderboard?sort=chips|net|staked|games|wins
```

Behind the `signedIn` wrapper the transfer routes already use — 401 with
`{ error: "Sign in first." }` when signed out. An unknown or missing `sort`
falls back to `chips` rather than erroring: it is a query parameter on a page
somebody linked to, not a command.

Rate-limited with `withinBudget`, generously — the page polls every ten
seconds, so the budget has to sit well clear of six a minute. Thirty per
minute per account leaves room for a fast finger on the sort headers without
leaving the route open to being hammered.

The reply:

```ts
{
  sort: LeaderSort;
  rows: LeaderRow[];          // top 100 by the chosen column
  you: { row: LeaderRow; rank: number } | null;
  total: number;
}
```

The limit is a constant in the server, not a query parameter. A client that
can ask for the whole playerbase is a client that will.

## The page

`/leaderboard`, in `apps/web/src/leaderboard/`, with `leaderboard.css`
imported from `main.tsx` beside the other page stylesheets. (Imported there
because that is where the room's and the profile's styles are wired in, and an
unimported stylesheet in this repo is dead rules nobody notices.)

### Getting there from the front door

A section under the tiles, in the room's own idiom — a `room__label` reading
**"Who's ahead"** over a single wide card showing the top three and, beneath
them, your own rank. Tapping it opens the board.

Signed out, the card says so and still links through, so a guest can see the
board exists rather than finding a link that is not there. The page itself
gives the same answer: sign in first.

The card reads the same route as the board and shows the first three of what
comes back. It does not ask for three: how many rows the route hands out is
the server's decision and not a query parameter, for the reason given above.
It polls on the same clock as the room's busyness — the room already refreshes
every ten seconds, so this is the rhythm the page is in.

### A row

Rank, face, name, chips, win rate, W–L, net, staked. Your own row is
highlighted wherever it falls, and if you are outside the top hundred it is
pinned to the bottom of the board with the gap made obvious rather than
faked — a board that quietly renumbers you into 100th is lying.

Net is signed and coloured, the way the profile already writes it.

### On a phone

At narrow widths a row is not a table row. It reflows into a card: rank, face,
name and chips on the top line, the four smaller figures wrapping underneath
as labelled pairs. Nothing scrolls sideways at 375px, and the sort headers
become a row of chip-style buttons that wrap rather than a header rail that
overflows.

### Live

A poll every ten seconds, replacing the board's rows in place.

The motion is the point: when the answer comes back and the order has changed,
**rows slide from where they were to where they now are** — measured before
the paint, transformed back, then released — so overtaking is something you
watch happen rather than something you notice happened. Chips tick with the
existing `Digits`, which turns only the columns that changed.

One motion per row: a row that is both moving and re-numbering does both in
the same animation, because two animations fighting over one element is the
bug rather than the effect.

`prefers-reduced-motion` drops the slide and the tick, and the board simply
shows the new order and the new numbers. Nothing on the page is only said by
an animation.

A refusal or a dropped answer leaves the board exactly as it was, the way the
room keeps its last answer rather than replacing the games with an error
nobody can act on.

## Testing

**economy**

- Ordering by each sortable column, in both stores, with the same expectations.
- Ties share a rank; the account after a three-way tie is 7th.
- The viewer's rank comes back when they are outside the limit.
- A profile document with no `chipsStaked` reads as zero, and a bump on it
  lands on zero rather than on `undefined`.
- `bumpStats` sums `chipsStaked` like the other shared totals.

**games**

- Greed stakes the buy-in, blackjack what the seat put out, roulette what the
  spin was staked, slots what the spin cost.
- A free spin stakes nothing.
- A for-fun roulette table and a play-money greed game write nothing at all.

**server**

- 401 when signed out.
- The payload carries no `discordId` — asserted on the keys, not by reading
  the code.
- An unknown `sort` falls back to chips rather than erroring.
- The limit is the server's, not the caller's.

**web**

- Rows render with the figures in them.
- Your own row is pinned when you are outside the top hundred.
- A header press re-sorts by asking the server again.
- A poll that changes the order updates the board without remounting the rows,
  which is what makes the slide possible.
- The stylesheet answers `prefers-reduced-motion`, and the row layout does not
  overflow at 375px — asserted against the CSS file the way `felt.test.ts`
  already does.

Every one of these is written before the code it describes.
