# Plinko — design

A peg board at the bar that everybody on the floor watches at once. Each player
drops their own balls, whenever they like, against Plinko's own bank. It is a
machine in the sense CLAUDE.md means — played against the house, on the
house's terms — and a shared one in the sense that matters for an evening: you
see everybody else's balls fall beside yours.

## Why it can exist

A ball dropped against the house is a game played alone, which CLAUDE.md
allows on exactly one footing: a bank that players alone fill, a stake cap
from the worst outcome, a cryptographic source, and no chips from outside
except an admin's float. Plinko takes that footing whole. It has no free
rounds and no deck, so neither of the extra clauses comes into play.

It keeps **its own bank**. Plinko holds back 3% of what goes through it —
between blackjack's half a percent and slots' tenth — and a shared bank would
be one of those games quietly paying for another.

## The board

Twelve rows of pegs, thirteen buckets. At each row the ball goes left or
right; the bucket is the number of rights, `0..12`.

The server draws all twelve at once: one `randomInt(0, 4096)` from
`node:crypto`, whose bits read top row first are the path. Every one of the
4,096 paths is equally likely, so the chance of bucket `k` is
`C(12, k) / 4096` — Pascal's triangle, exact, no simulation:

```
bucket   0   1   2    3    4    5    6    7    8    9   10  11  12
paths    1  12  66  220  495  792  924  792  495  220  66  12   1
```

`randomInt` with a bound, never a scaled float: a float scaled into a range is
not uniform, and `Math.random` is the thing a player watching every result
could recover (CLAUDE.md, "its outcomes come from a cryptographic source").

### Risk

One board means one row count — everybody has to see the same pegs — so the
choice a player makes is risk, which only changes their own multipliers.
Symmetric; listed edge to centre, in tenths of the stake:

| Risk   | 0 / 12 | 1 / 11 | 2 / 10 | 3 / 9 | 4 / 8 | 5 / 7 | 6 (centre) |
|--------|-------:|-------:|-------:|------:|------:|------:|-----------:|
| Low    |    80  |    29  |    17  |   12  |   11  |   10  |       5    |
| Medium |   330  |   120  |    35  |   17  |   11  |    6  |       4    |
| High   |  1700  |   180  |    80  |   18  |    7  |    3  |       2    |

i.e. Low runs 8× … 0.5×, Medium 33× … 0.4×, High 170× … 0.2×.

### The return, which is exact

```
RTP = Σ paths(k) × mult(k) / (4096 × 10)
```

All three risks come to **39,730 / 40,960 = 96.9971%**. The same fraction for
each, deliberately: no risk is a worse bet than another by accident, the same
argument two-up makes for its Five Odds price. A test asserts the numerator,
so changing a multiplier without retuning fails.

### Stakes are in tens

Stakes are whole multiples of 10, from 10. Every multiplier is in tenths, so
every payout is a whole number of chips and nothing is ever rounded.

The alternative was flooring, and flooring is not neutral: a 1-chip ball at
1.7× would pay 1, and at small stakes the return would sit far below the
figure on the sign. A stake in tens pays exactly what the table says.

## The bank

`BANKS` in `packages/economy/src/store.ts` gains `"plinko"`. The server holds
one `plinkoBank = new BankLedger()` and every paid drop runs inside
`plinkoBank.serially(...)`:

1. Validate: signed in, stake a positive multiple of 10, risk known.
2. Read the bank; refuse if `stake > maxStake(bank, risk)`.
3. `deps.take(user, stake)`, then `store.bankAdd("plinko", stake)`. The stake
   is in the bank before anything is drawn.
4. Draw the path; `won = stake × mult / 10`.
5. `store.bankTake("plinko", won)`. If it refuses — which the cap makes
   unreachable — refund the stake from the bank and report the drop as short.
6. `deps.give(user, won)`, record, acknowledge, broadcast.

The whole drop settles on the server at the press. The animation that follows
shows a result that has already been paid; nothing is owed while a ball is in
the air, so a hundred balls in flight are a hundred settled drops, not a
hundred open liabilities.

### The stake cap

The worst drop is the edge bucket at the risk played. The stake is already in
the bank when it pays, so:

```
edge × stake ≤ bank + stake
       stake ≤ bank / (edge − 1)
```

```
maxStake(bank, risk) = floor(bank / DIVISOR[risk] / 10) × 10
DIVISOR = { low: 7, medium: 32, high: 169 }
```

The edge multipliers are whole numbers, so the divisors are exact. A thin bank
means a smaller High stake — never a short payout. `worstCase(bank, stake,
risk)` is exported for the property test, and `STAKE_DIVISOR = 169` (the worst
of the three) is what the admin bank route asks when it wants to know what a
bank could take at all.

A 50,000 float permits 290 on High, 1,560 on Medium and 7,140 on Low.

### The float

The existing `POST /api/admin/bank?game=plinko`, behind `requireAdmin`, written
to the admin log as a float like every other. `capOf` and `emptyOneBank` in
`server.ts` gain a Plinko arm (TypeScript forces both once `BankName` grows),
and `apps/web/src/admin/Banks.tsx` gains a panel. `GET /api/plinko` is the
public sign: `{ bank, caps: { low, medium, high } }`.

### Drops in flight

A player may tap as fast as they like. Each drop is its own request and
settles in turn through the ledger. An account may have at most **10 drops
waiting** on the server at once; the eleventh is refused ("Too many balls in
the air") rather than queued, so nobody can pile work onto the ledger faster
than it clears.

### Play money

Exactly as slots: `forFun: true` is answered from a per-socket
`{ purse, bank }` that never touches the store, the house bank, stats or the
floor, topped back up when the purse cannot cover the smallest stake, and
dropped on disconnect. Same cap, same multipliers, same draw.

### Stats

Per paid drop: `shared: { chipsWon, chipsStaked }`, and under `game: "plinko"`
`add: { drops, staked }`, `max: { bestMult }`. No game history per drop —
it would flood it, and a drop has no players or winners to write.

## Not a table

No `GameAdapter`, no seats, no lobby code, no round clock, no bots. Plinko is a
`shape: "machine"` listing that sits at the bar beside slots, for the reason
the slots spec gives: forcing a machine through a table would bend both.

## The shared board

Opening Plinko joins the `plinko:floor` room. Everybody there watches one board.

- **Your balls** are the Plinko accent at full size, and are driven by your own
  ack — they start on the press.
- **Everybody else's** arrive as `plinko:dropped` broadcasts and fall along
  their real path, slightly smaller and dimmer, in the player's colour: one of
  eight, chosen from their account id so a person is the same colour every
  visit.
- **Bucket labels are your own risk.** A High player can land in the same
  bucket as you and be paid something else, so another player's landing
  flashes the bucket in their colour, and a hit of **10× or more** floats a
  tag above it — `Mia ×33` — so the room sees the big ones. Smaller hits go to
  the feed only.
- **At most 30 other balls** are drawn at once; past that, drops go straight to
  the feed. Your own always animate.
- **The feed** is the floor's last 12 paid drops, kept in memory on the server
  like slots' wall. On a phone, one row of multiplier chips edged in each
  player's colour, clipped in its own box. On a desk, a side list: name,
  stake, multiplier, won.
- **Who's here**: "4 at the machine" and their colour dots, pushed on every
  arrival and departure.
- **The bank is live.** Every broadcast carries the bank after that drop, so
  every sign and every cap on the floor moves while other people play.
- **Play money is private.** A for-fun ball is never broadcast and never in the
  feed. A for-fun player still watches the real floor.

### Protocol

```ts
// client -> server
plinko:watch                         ack { recent: PlinkoDrop[], here: Watcher[], bank, caps }
plinko:away
plinko:drop { stake, risk, forFun? } ack { ok: true, path, bucket, mult, won, balance, bank, caps }
                                         | { ok: false, error }
// server -> floor
plinko:dropped PlinkoDrop            // to everyone on the floor but the dropper
plinko:here    Watcher[]
```

`PlinkoDrop = { id, by: { name, colour }, risk, path, bucket, mult, stake, won, bank }`.
Types in `packages/shared/src/protocol.ts`; `plinkoDropSchema` in
`packages/shared/src/schemas.ts` beside `spinSchema`, imported by the server
from the `@backroom/shared/schemas` subpath.

## How a drop feels

The rule is never invent a fact, and the board has one honest move before the
server has spoken: **every path starts on the top peg.**

1. **Press.** The stake leaves the balance at once — it is the player's own
   number — with the sampled chip cue.
2. **The ball falls from the chute onto the top peg** (~250ms), which invents
   nothing, and rocks there, waiting. On most connections the answer is back
   before it arrives; on a bad one it visibly waits rather than guessing a
   direction.
3. **The answer lands.** From the top peg it hops row by row down its real
   path, each hop a short arc with a little settle, each peg it touches
   lighting briefly. About 1.4s top to bottom.
4. **It lands.** The bucket dips and glows, a `+won` chip rises out of it, and
   the balance counts up. The server paid at the press; the balance holds the
   win back until the ball lands, as slots holds its `owed`, so the number
   changes because something happened.
5. **Refused, or no answer within 10s**: the ball lifts back into the chute,
   the stake returns, and a line says why.

One motion per ball: the waiting rock on the top peg hands straight into the
first hop, with no restart.

### Sound

- **Peg ticks** — synthesised: they fire far too often for a sample to wear
  well. Very quiet, falling in pitch as the ball descends.
- **Landing** — a synthesised tone pitched by the multiplier: 0.2× thuds, 170×
  rings.
- **The stake** reuses the sampled chip cue; a hit of 10× or more reuses the
  win stinger.
- All under the player's volume and mute, like every cue in `audio.ts`.
  Other players' balls tick and land at a fraction of the volume of your own.

### Reduced motion

No fall. The bucket lights, the path shows for a moment as a faint trail of lit
pegs, and the balance steps once. The page still says which bucket and what it
paid.

## Layout — one screen

It meets L1–L8 of the table requirements, as Greed and Blackjack do.

- **L1**: `.shell:has(> .play--plinko)` is `100dvh` less the safe areas, the
  page a flex column with `min-height: 0`.
- **L2**: `.pk__in` is a grid: `auto` (sign and feed), `minmax(0, 1fr)` (board),
  `auto` (controls).
- **L3**: the board is one SVG in a `container: pk-board / size` box, with a
  `viewBox` and `preserveAspectRatio="xMidYMid meet"`. Balls are circles in the
  same SVG, so they scale with it. A short phone shrinks the board; the
  controls stay put.
- **L5**: phone is one column — sign, feed row, board, controls. Past 760px of
  table (`@container`), board on the left and a side column: sign, full feed,
  who's here, controls.
- **Controls**, built from the fittings (F1), within a thumb's reach:
  a `Seg` for Low / Medium / High; stake as `.key` ½, −, a `.readout`, +, 2×;
  one lit `.slab` reading **DROP · 50**. The stake keys clamp to the cap and
  the balance, and show why when they cannot go further.
- **L6/L8**: checked by hand at 375×560, 375×667, 375×812, 768×1024 and a desk:
  no sideways scroll, and DROP visible without scrolling.

### Theme

Teal over deep ink, distinct from every game in the building:

```
wall #0c1519   felt #12262d   accent #22b8c8   accentHi #7cecf5
```

Mark: `PLINKO` with the O picked out (`accentAt: 5`) — it reads as the ball.
The same values in `listing.ts` and `theme.css`, which `theme.test.ts` checks.

## Where the code lives

```
games/plinko/src/
  board.ts       rows, path → bucket, drawing a path from a source of randomness
  risk.ts        the three multiplier tables
  rtp.ts         the closed-form return
  bank.ts        the cap, divisors, worst case, stake rules
  listing.ts     how Plinko lists itself
  theme.css
  index.ts

apps/server/src/plinko.ts   wirePlinko(socket, …): the floor, the drop, fun mode
apps/web/src/plinko/
  Plinko.tsx     the page
  Board.tsx      the SVG board and its balls
  useDrops.ts    press → ball → answer → landing, and giving up
  plinko.css
```

The server wiring goes in its own file, as `tips.ts` does, rather than growing
`server.ts` by another thousand lines.

### Where it has to be announced

`BANKS`; `capOf` and `emptyOneBank`; `admin/Banks.tsx`; `CATALOGUE.add` in
`server.ts`; `og.ts` `MOTIFS`; `room/TileArt.tsx` `motif()`; `room/Room.tsx`
theme import; `App.tsx` route; `vite.config.ts` `optimizeDeps.exclude`; the
server and web `package.json` deps; the `Dockerfile` (checked by
`packaging.test.ts`); `catalogue.test.ts` `BUILT`; `site.webmanifest`
shortcuts; and CLAUDE.md's repo map and its list of games on the bank footing.

## Testing

Every arithmetic claim is tested as arithmetic.

**`games/plinko`**
1. Path → bucket is the count of rights, and all 4,096 draws cover each bucket
   exactly `C(12, k)` times.
2. Each risk returns exactly 39,730 / 40,960.
3. The edge bucket is the largest multiplier at every risk — the cap rests on it.
4. **Insolvency is unreachable**: for a sweep of banks and every stake the cap
   permits at every risk, `worstCase ≤ bank + stake`; one ten above the cap
   is not.
5. Stakes that are not positive multiples of 10 are refused.

**`apps/server/src/plinko.test.ts`**
1. Nothing is minted: over a scripted sweep, player delta plus bank delta is
   zero every drop.
2. The bank never goes below zero; over-cap stakes are refused with the felt
   untouched.
3. Not `Math.random`: the draw comes from the injected source, and the default
   is `node:crypto`.
4. The float lands in the Plinko bank and no other; the sign reports it.
5. Play money never touches the store, the bank, stats or the floor.
6. The floor hears a paid drop; the dropper does not hear their own; a
   for-fun drop is heard by nobody.
7. The eleventh drop in flight is refused; two accounts dropping at once
   settle serially and both are paid.

**`apps/web`**, on a fake clock rather than by eye:
1. The ball reaches the top peg and holds there until the ack arrives — it
   never moves past the first peg without one.
2. A refusal, and a silence of 10s, each return the ball to the chute and the
   stake to the balance.
3. The balance holds a win back until the ball lands.
4. Reduced motion renders no fall and still names the bucket and the payout.
5. The stylesheet test: the board's size variable is set on its container only
   (L4).
