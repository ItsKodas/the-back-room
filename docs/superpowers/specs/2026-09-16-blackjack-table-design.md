# Blackjack table — design

Brings the Blackjack table up to `2026-09-16-table-requirements.md`. Requirement
IDs (`L1`, `K3`, …) refer to that document. `CLAUDE.md` still wins over both.

Two PRs, in order:

1. **The shared table pieces** — section 12 of the requirements. Greed moves onto
   them and looks and plays the same.
2. **Blackjack** — the table itself, built on PR 1.

## Decisions

| Question | Decision |
|---|---|
| Sequencing | Two PRs, shared work first. |
| Keys | Space is the lit slab: **Ready** while betting, **Hit** on your turn. **S** stands, **D** doubles, **P** splits. |
| Table stake (open question 2) | None. The chip bets placed each betting window are the only stake; the server already works this way. No `Stake` picker on setup. |
| Host controls | Behind a **Table** key on the felt. Deal now stays a secondary key in the betting controls. |
| Controls on a phone | At the bottom (K1), not above the seats as the Blackjack checklist says. They went above the seats so betting did not mean scrolling past everybody; on one screen they are always in view, so that reason is gone. |

---

## PR 1 — the shared table pieces

### Refusals in `useTableSocket` (N3, N4)

- Add `errorKey: number` to `TableSocketHook`, and a `refuse(message)` that sets
  the error and bumps the key, as `apps/web/src/game/useRoom.ts` does.
- `refuse` is used for `room:error`, refused `lobby:create` / `lobby:join` /
  `lobby:watch` acks, and a refused `taunt:send`.
- `room:closed` sets the error **without** bumping the key: it is a notice, and
  the player lands on a page that shows it as the strip.
- The 4-second clear is keyed on `[error, errorKey]`, so a repeated refusal gets
  its full four seconds.

### Pending moves clear on every refusal

These drop a pending move on `[error]` only, so a second identical refusal leaves
the move hanging. Each is switched to watch `errorKey`:

- `apps/web/src/blackjack/useIntent.ts`
- `apps/web/src/poker/useIntent.ts`
- `apps/web/src/deathroll/useIntent.ts`
- `apps/web/src/twoup/TwoUp.tsx` (two effects)

The hooks take `errorKey` alongside `error`, and clear on either moving. Taking
the key alone would make a test that passes against the old code, since a
number is never null, so it could not be watched failing.
Each fix gets a test watched failing against the old code.

### Shared components move to `apps/web/src/table/`

`TalkSheet.tsx`, `Activity.tsx`, `Refusal.tsx`, `Stake.tsx` and their tests move
from `apps/web/src/game/`. Greed's imports follow.

`useActivity` stops depending on Greed's `RoomView`:

```ts
useActivity(source: { code: string; text: string | null; seq: number } | null)
```

Greed passes `{ code, text: room.lastEvent, seq: room.turn?.rollSeq ?? 0 }`.
Behaviour is unchanged: a line when the words change or the counter moves on,
nothing when the counter resets, a fresh log at a new table, capped at 100.

### `apps/web/src/table/table.css`

Split out of `greed.css` and imported by the components above (H1):

- the talk sheet, scrim, head, chat dress and the lobby's `talk-panel`;
- the talk key and its unread count;
- a shared corner class for the talk key, replacing `.gt__talk`;
- the activity log, and the log inside the sheet;
- the refusal;
- the scrollbar rules (M2);
- a `prefers-reduced-motion` block covering all of the above (M1).

Renames so the names are the building's and not Greed's (H2): `gt-talk-up` /
`gt-talk-in` become `table-talk-up` / `table-talk-in`. The desk-width drawer
query stops using Greed's `gt` container and uses a container on the fitted page
instead, so it works at any table.

### `.play--fit`

Lives in `table.css` and replaces the `.play--greed` shell rules in
`greed.css`:

- `.shell:has(> .play--fit)` is `100dvh` with a `minmax(0, 1fr)` row; the page is
  a flex column with `min-height: 0` (L1);
- the bar's side padding on a phone (L7);
- the page as the frame a refusal blurs and centres in;
- `.play--fit > .play__error` as today.

Greed renders `play play--fit` at the table. Everything that is Greed's own look
stays in `greed.css`.

### Tests

- `useTableSocket.test.ts`: a repeated identical `room:error` bumps `errorKey`
  twice; a refused ack bumps it; `room:closed` does not.
- The three `useIntent` tests and Two-Up's: a pending move clears on a second
  identical refusal (watched failing first).
- `Activity.test.tsx`: moved, and fed the new source shape.
- `table.css.test.ts`: scrollbar rules sit inside
  `@supports not selector(::-webkit-scrollbar)`; every animated selector in the
  sheet is in its reduced-motion block.
- `table.css.test.ts` also covers the one-screen rules now on `.play--fit`
  (`100dvh`, the `minmax(0, 1fr)` row, `min-height: 0`), which no test guards
  today. `greed.css.test.ts` and `shell.css.test.ts` stay green.
- By hand: Greed at 375×667 and at a desk, looking as it did.

---

## PR 2 — Blackjack

**Approved mockups:** `docs/design/2026-09-16-blackjack-mockups.html`
(published as the artifact "Blackjack Felt Mockups"). Where this section and
the mockups disagree about how something looks, the mockups win; where they
disagree about what the table does, this section wins.

### First: the floor's `.activity` gives up the name (H2)

`apps/web/src/room/Activity.tsx` renders `section.activity` and
`apps/web/src/leaderboard/leaderboard.css` styles `.activity { display: flex … }`.
That sheet loads after `table/table.css` and overrides the shared activity log
on every page. The room's copy is renamed `.floor-activity` (component, sheet,
`Room.test.tsx`), with a stylesheet test that no sheet but `table/table.css`
declares a top-level `.activity` rule. Greed's log then renders as `table.css`
intended; check it by hand.

### Server: `eventSeq` (A4)

`TableView` in `games/blackjack/src/table.ts` gains `eventSeq: number`, bumped
wherever `lastEvent` is set. Test: the same event twice running ("Ada is ready")
moves `eventSeq` twice.

### Layout (L1–L8)

- The page is `play play--fit` at the table, and a scrolling page on setup and
  sign-in.
- `.bj` is a container (`bj / inline-size`) and a grid of three rows on a phone:
  **readout** (`auto`), **felt** (`minmax(0, 1fr)`), **controls** (`auto`).
- The felt is a `container: bj-felt / size` holding the dealer's patch on top and
  the seats below.
  - Your seat comes first, full size: big cards and a big total.
  - Other seats are compact plates, two across on a phone: small cards, total,
    stake, state tag. When there are more than fit, the felt scrolls inside
    itself with the room's bar, never the page.
- **Cards take the room the felt has.** Widths are set on containers only and
  inherited by `.bj-card`, which never declares `--bj-card-w` itself (L4):
  - phone: dealer `clamp(34px, min(19cqi, 15cqh), 74px)`, your seat
    `clamp(38px, min(22cqi, 18cqh), 84px)`, other seats
    `clamp(20px, min(9.5cqi, 8.5cqh), 38px)` — the height terms are what keep
    all three inside the felt on a short phone;
  - desk (`@container bj (min-width: 760px)`): dealer
    `clamp(40px, min(12cqi, 20cqh), 124px)`, your seat
    `clamp(40px, min(9.5cqi, 17cqh), 100px)`, other seats
    `clamp(24px, min(6.2cqi, 12cqh), 70px)`; seats run along the bottom of the
    felt with yours wider (`1.5fr` against `1fr` each).
- **A dealt hand overlaps** by 28% of a card's width, so every card's corner
  index still shows. The dealer's hand does not overlap.
- **Splits.** A split seat keeps one plate and grows a box per hand, each with
  its own stake, cards (overlapping 42%), total and outcome tag. The box the
  controls act on is lit neon; the other is dimmed while it waits. Card width in
  a split seat is `clamp(26px, min(12cqi, 15cqh), 52px)`. Another player's split
  shows as two small hands on their compact plate with a hairline between. The
  readout's label becomes "Hand N of M" and its stake is that hand's.
  The table splits once per seat; the layout also holds four boxes (a stress
  case, not a rule change), four across with the total wrapping under.
- **Scrolling.** Anything that scrolls — the felt, the talk and Table sheets,
  the activity log — wears `.table-scroll` from `table/table.css` (M2), so no
  system scrollbar with arrows appears anywhere on the table.
- `@container bj (min-width: 760px)`: the felt on the left spanning every row,
  and a side column on the right with readout, rules, activity and controls
  (L5).
- The old `@media (max-width: 720px)` arrangement goes.

### Seats (T1)

- Seat plates. The seat whose turn it is is lit in the room's neon; yours is
  outlined in `--gr-color-chip-dim`.
- Waiting and dropped seats are dimmed, never hidden. Their state is written at a
  desk and screen-reader-only on a phone.
- Kept: the gold bet, the chip pile, the turn ring, the paid glow, the split
  hands with the live one marked.

### Readout (T2)

A `.readout` block, with the clock draining along its top edge (`--t`).

| State | Big figure | Beside it | Clock |
|---|---|---|---|
| Betting | your stake, gold | balance (purse at a for-fun table), min–max | betting window; gold at last call |
| Your turn | your hand's total, with "soft" | this hand's stake, gold; dealer showing | your turn |
| Someone else's turn | their hand's total, under their name | their stake, gold; dealer showing | their turn |
| Settled | your net, good or bad colour; "Push" or "Sat out" | dealer's total | next hand |
| Watching | as someone else's turn | — | as above |

### Rules card (T3)

A `?` key in the felt's top-right corner on a phone opens a sheet; at a desk the
card sits in the side column. Rows:

- Blackjack pays 3 to 2
- A win pays 1 to 1
- A push returns the stake
- Dealer stands on 17
- Double on your first two cards
- Split a pair once

It lights the rows that apply now: Double and Split when they are available to
you, and your settled outcome's payout row.

### Big moments (T5)

- A "Blackjack" banner, once, when your hand is a natural.
- A "Bust" stamp, once, when your live hand busts.

Neither loops, and both are in the reduced-motion block.

The card arriving face down on Hit or Double stays as it is (T4).

### Controls (K1, F1–F5)

The controls are the table's bottom row: secondary keys on the left, one lit slab
on the right, at least 52px tall.

| State | Left (`.key`) | Right |
|---|---|---|
| Betting | a row above: the chip tray, five chips in a sunk `.well`; below it **Take it back** (icon key, 52px square) and, host only, **Deal now** | `.slab` **Ready** (Space), with the betting clock under the label. Once pressed it reads "Waiting… for the others" and pressing again un-readies. Disabled when the stake is above zero and below the minimum. |
| Your turn | **Stand** (S) across two columns on top; **Double** (D) and **Split** (P) under it, each with its cost or the reason it is out on the key (F5: "+500", "3 cards", "no pair", "once a seat"). After a split, Stand and Hit say which hand ("hand 2"). | `.slab` **Hit** (Space) in the third column, spanning both rows, `.is-busy` from the press until the table answers or refuses (F4) |
| Someone else's turn | — | disabled `.slab` "Ada's turn" with the time left; taunt key on the right (K5) |
| Settled | — | disabled `.slab` "Next hand in 5s"; taunt key |
| Watching | the watching note | — |

- The chip tray stays the in-hand bet (S5), dressed as fittings. The last-call
  lock, the pile bump and the balance beside the bet stay.
- The taunt picker renders with `openClassName="key"`.
- Every shortcut is declared with `aria-keyshortcuts`.

### Keys (K2–K4)

A window `keydown` listener, bound once and read through refs, as in
`apps/web/src/game/Table.tsx`.

- **Space** presses the slab; **S**, **D** and **P** press Stand, Double and
  Split.
- Nothing happens:
  - in an `input`, `textarea`, `select`, `[contenteditable]`, or inside
    `[role="dialog"]`;
  - with Ctrl, Alt or Cmd held, or on a key repeat;
  - when the button the key stands for is disabled or busy.
- Space also leaves a focused link or non-chip button alone.
- A chip a pointer last went down on hands Space to the slab. A chip reached by
  keyboard keeps Space for adding itself. Remembered on `pointerdown` and
  forgotten on `focusin` elsewhere — never read from `:focus-visible`.

### Host tools

A **Table** key in the felt's corner next to `?`, shown to the host only. It
opens a sheet (`role="dialog"`, Escape and scrim close it, focus returns to the
key) containing:

- **Time to bet** — `Seg` over `WINDOWS`, "Takes effect on the next hand.";
- **Who can find it** — `Seg` Public / Private;
- **Add a player** — `.key--small` Easy / Normal / Hard, at a for-fun table with
  a free seat only. The server still refuses otherwise.

### Talk, activity, refusals (C, A, N)

- `TalkKey` in the felt's top-left corner opens `TalkSheet`, with the activity log
  as its second tab (C1–C3). `Chat` is not wrapped in another region (C5).
- `useActivity({ code, text: lastEvent, seq: eventSeq })`. At a desk the log is
  its own panel in the side column (A2).
- The `.play__event` strip and the inline `.play__talk` go.
- At the table, errors show as `Refusal message={table.error} id={table.errorKey}`
  (N1–N3). On setup and sign-in they stay `.play__error` (N5).
- The chip buttons already refuse amounts over the ceiling before the press
  (N6).

### Stylesheet

- No `.btn`, `.btn--move`, `.btn--ghost`, `.panel`, `.panel__note` or `.bots`
  left on the table; their rules in `blackjack.css` go.
- Class names stay prefixed `bj__` (H2).
- Every new keyframe is added to the sheet's reduced-motion block (M1). Any lit
  bespoke control keeps its pseudo-elements inside its corners (M3).

### Tests

- `blackjack.css.test.ts`:
  - `.shell:has(> .play--fit)` rules apply;
  - the felt is a size container and sets the card size variable;
  - `.bj-card` does not declare `--bj-card-w` itself;
  - every animated selector is in the reduced-motion block.
- Key handler tests:
  - Space readies while betting and hits on your turn; S, D and P fire;
  - each K3 exclusion holds;
  - a clicked chip hands Space to Ready while a tabbed-to chip keeps it, with
    `:focus-visible` spied true to prove it does not decide.
- `Blackjack.test.tsx`:
  - exactly one enabled `.slab` per state;
  - a refusal at the table renders `Refusal`, not `.play__error`;
  - no `.play__event`;
  - the host sees the Table key and nobody else does.
- `games/blackjack`: `eventSeq` bumps on a repeated identical event.
- By hand:
  - the L8 sizes (375×560, 375×667, 375×812, 768×1024, a desk), including
    375×560 with six seats, signed in;
  - a throttled connection for the busy Hit;
  - a refusal with the felt blurred;
  - talk opened on a phone.

## Not in scope

- Poker, Roulette, Two-Up and Death Roll layouts. PR 1 only fixes their pending
  moves on `errorKey`.
- A pre-hand table stake.
- Setup-page changes beyond what fittings already give `TableSetup`.
