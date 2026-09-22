# Roulette table — design

Brings the Roulette table up to `2026-09-16-table-requirements.md`. Requirement
IDs (`L1`, `K3`, …) refer to that document. `CLAUDE.md` still wins over both.

Roulette is the table that has not moved. It uses none of the shared pieces:
no `play--fit`, no `TalkSheet`, no `Activity`, no `Refusal`, no `.key` or
`.slab`. Section 12's shared work is all done — `errorKey` is on
`useTableSocket`, the shared components live in `apps/web/src/table/`, and
`play--fit` is in `table.css` — so this builds on it rather than repeating it.

One PR. Blackjack (`2026-09-16-blackjack-table-design.md`) and Plinko
(`2026-09-20-plinko-design.md`) are the worked examples for everything
structural here.

## Decisions

| Question | Decision |
|---|---|
| Scope | The whole of section 13's Roulette checklist, plus the new bet placement. |
| Phone stage (open question 3) | One stage that swaps by phase: the cloth holds it while betting and settling, the wheel takes it while the ball is rolling. |
| Boards on a phone (open question 3) | History stays a thin strip at both sizes (A3). Winners folds into the activity tab on a phone, and keeps its own panel at a desk. |
| Talk key (open question 5) | The column beside the cloth, with `?` opposite — the same dead space the wheel's medallion sits in. |
| Keys (open question 1) | `R` same again, `U` undo, `C` clear. **No Space binding.** |
| The lit slab | **None at all.** K1, K2 and F2 are deliberately not met; see below. |
| Custom bet | A typed figure, latched like Slots'. No protocol change — the server already takes it. |
| Placing a chip | Preview on press, act on lift. Hold past 500ms to take back. |

### Why there is no lit slab

Roulette has no "spin": the table deals itself, and chips go down as they are
placed. The only one-press action is **Same again**, which puts a whole round's
money back on the cloth. `Roulette.tsx` already says why that is not lit:

> One of them spends money — "same again" puts a whole round back down — and
> lighting it up the way a primary action is usually lit would be the felt
> leaning on the player.

That stands. Same again, Undo and Clear stay three equal-weight `.key`s, and
the PR records K1, K2 and F2 as deliberately unmet with this reason — which
section 14 explicitly allows.

**There is no `.slab` anywhere on this table.** The obvious candidate would be
"Take a seat" while watching, whose main action costs nothing — but there is no
sit-down action on the wire. A seat is taken on the way in, for both Roulette
and Blackjack, so a watcher has nothing to press and the felt says so in words
instead.

---

## 1. Layout — one screen (L1–L8)

`<main className={"play" + (atTable ? " play--fit" : "")}>`, as Blackjack does:
setup and join are pages and keep scrolling; the felt is the window.

`.rl` becomes `container: rl / size`. `.rl__in` is the grid:

```
rows: auto            standing
      minmax(0, 1fr)  stage          <- the only row that flexes (L2)
      auto            controls
      auto            seats
```

**Phone:** one column.

**Desk (`@container rl (min-width: 900px)`):** the cloth takes the stage; a
right-hand side column carries the wheel, its caption and the Winners board;
controls and seats span the bottom, so the actions stay one row under the cloth
at both sizes (K1). History is *not* in that column — it is a thin strip above
the stage at both sizes, which is what the decision on boards says. Nor is the
activity log: it lives in the talk sheet's second tab at both sizes, which is a
deviation from A2 and is written down as one in the standard.

Nine hundred, and the number is derived rather than chosen. The cloth lies down
below 560px of its own width (`TURNS_AT`, in `Cloth.tsx`). The side column takes
26% of the table and the corner about 44 with its keys in it, so the cloth is
handed roughly `0.74C - 52` — 614px at 900, and under `TURNS_AT` at 760. A
lower threshold stands a *portrait* cloth on a desk, which is the disagreement
the layout before this one shipped with. Anybody moving this figure moves it
against that arithmetic rather than by eye; it has been lost once already.

The wheel moves *into the side column* rather than staying beside the cloth as
it is today. That is deliberate. `roulette.css` already carries a scar from the
present arrangement:

> Nine hundred rather than the seven-twenty this was first written at, and the
> number is not free. Standing the wheel beside the cloth leaves the cloth about
> seven tenths of the room, so a container of 720 handed it barely 520 — under
> the width at which the cloth decides to lie down.

Giving the cloth the whole stage width shrinks that coupling; it does not
remove it, because the corner column of keys stays beside the cloth. The
container query and `TURNS_AT` still have to be held in agreement by hand,
which is what the arithmetic above is for.

### L3 — sized from the space it has

`.rl__stage` is `container: rl-stage / size`, and the cloth is sized from
`min(…cqi, …cqh)`. A short phone shrinks the cloth rather than pushing the
controls below the fold.

### The cloth will still scroll inside its own box, on short phones only

Stated plainly because it is the one requirement this table cannot meet the
easy way. The portrait cloth is 14 grid units tall by 5 wide, so its height is
always about 2.8× its width. Squares big enough for a thumb (~44px) need ≥220px
of cloth width, which forces ≥616px of height. A 375×560 phone has not got that
with nothing else on screen, let alone with a standing line, controls and seats.

So: the **page** never scrolls (L1 holds, and L8 is checked), and the cloth
scrolls vertically inside its own box on the shortest phones. L6 allows exactly
this — *"Anything that must be wide scrolls in its own box"* — and Blackjack's
felt already does it with `.table-scroll`, which also gives it the room's own
scrollbar (M2).

The rejected alternative was splitting the cloth into two panes (numbers /
outside) behind a `Seg`. Every square would be comfortably thumb-sized and
nothing would scroll — but crossing from a number to Red would cost a press,
and a bet placed on the other pane would be invisible.

## 2. The stage, and the phone's swap

`.rl__stage` holds two things that each want the whole of a phone. It gives the
stage to whichever of them is the one that matters:

- **`betting` and `settled`:** the cloth holds the stage. The wheel shrinks to
  an ~84px medallion in the column beside it, captioned with a count —
  *"12 of 37 covered"*. A count rather than the covered-pocket marks it draws
  today, because 37 pockets at that size are unreadable, and the count is the
  fact the player wants anyway.
- **`spinning`:** the wheel rises and fills the stage, cloth dimmed behind it.
  The cloth is shut in this phase regardless (`rl__cloth--shut` already), so
  nothing reachable is covered up.
- **Back at `settled`, not at the next window.** Settling is when the cloth is
  worth looking at: the winning square lights (`rl__square--won`) and the
  payouts land on the seats. The medallion returns showing the called number.
- **Desk:** no swap. There is room for both, and the wheel keeps its full
  covered-pocket marks in the side column.

One motion per thing (`CLAUDE.md`): the wheel grows from the medallion's
position into the stage and back, rather than one element fading out while
another fades in. Every keyframe added goes in the sheet's own
`prefers-reduced-motion` block (M1), where the swap becomes an instant change
of place with no travel.

**T4 holds unchanged.** The wheel is already told the pocket at the moment
betting closes so it can roll the ball there, and `Felt` already withholds it
from the cloth until the ball lands:

> a lit square on the cloth is the answer, several seconds early.

Nothing in the swap may leak it earlier — in particular the medallion's caption
says nothing about the result until `landed` is non-null.

## 3. Placing a bet

Two halves: what you bet with, and where it lands.

### 3.1 The chip keys

Today's `.rl__chip` tray becomes a radiogroup of `.key`s (F1), each carrying a
`<Chip>` face and its figure. `CHIPS` is unchanged — 25 to 5000, the same
denominations the card tables mint. A key is dark when it is over the balance
or the play purse; the held key never darkens, for the reason Slots gives:
mid-action its own stake is out of the balance, which is not the same as being
unable to cover it.

### 3.2 The custom bet

An `.own` block modelled on Slots' (`Slots.tsx`, `BetKeys`): a numeric input,
`25 – {most}` in the placeholder, Enter or a **Bet it** key to latch it,
formatted on blur, `aria-pressed` while held. The requirements already name
this as the model to copy (section 13, "Slots and the tip jar").

**No protocol change.** `Table.check()` refuses anything below `MIN_CHIP` and
anything non-integer, and accepts every integer above it:

```ts
if (!Number.isInteger(chips) || chips < MIN_CHIP) {
  throw new TableError(`The smallest chip here is ${MIN_CHIP}.`);
}
```

A typed figure is already legal on the wire. The seven tray denominations are a
client convenience and always were.

The ceiling shown in the placeholder is the lesser of the balance (or the play
purse) and the best headroom anywhere on the cloth. It is a courtesy, not a
rule (S3): the server checks `headroom` again on the way in, per spot, counting
everybody's chips.

### 3.3 The said line

One `aria-live="polite"` line under the keys absorbs the three separate
messages the felt has today — the empty-bank line, the `refused` cap line, and
(new) why a key or a typed figure will not go on. This keeps N6: a limit the
client can already see is said in place rather than left for the server to
refuse. The empty-bank line keeps its priority; section 13 lists it under
"Keep".

Its words come from a pure function with its own tests, as `betSaid` does in
Slots.

### 3.4 The gesture

The cloth names the bet you are about to make *before it costs anything*. It
does that today with a hover preview (`rl__aim`), which on a phone is nothing
at all — `CLAUDE.md`: *"Hover is not a way to reach anything."*

So, on any pointer:

| | |
|---|---|
| **down** | names the bet under the finger — *"Split 14/17, pays 17 to 1"* — and parks a ghost chip on the anchor |
| **move** | re-aims; the name and the ghost follow |
| **up** | places it |
| **held past 500ms** | the label turns to *"Release to take it back"*; lifting takes chips off instead |
| **up outside the cloth, or `pointercancel`** | nothing happens |

Pointer capture is taken on the press. This is the opposite of Plinko's drop
key, which refuses capture so a thumb can slide off to escape a hold — here
sliding is how you aim, and the escape is lifting off the cloth.

A desk is unchanged: hover previews, click places, right-click takes back. The
long-press already raises `contextmenu` on touch, so take-back keeps the
gesture it has; what is new is that it announces itself first.

The off-screen `.rl__reach` buttons — all 157 bets, in the tab order — stay
exactly as they are. Aiming is a pointer's talent; that list is the keyboard's
table and is not replaced by any of this.

### 3.5 Sound

`play("bet")` when a chip lands — section 13's *"A cue when a chip is placed (it
is silent today)"*. The chips-slide sample on a take-back. Both already exist in
`game/audio.ts` and are what Blackjack's felt uses.

## 4. Fittings (F1–F5)

- `.rl__chip` → `.key` with a chip face.
- `.rl__act` → `.key` (three of them, equal weight — see *Why there is no lit
  slab*).
- Setup's `.stakes__pick` betting-window picker → `Seg`.
- No `.slab` at all — see *Why there is no lit slab*.
- F3 holds: gold on figures (the stake down, the purse), the room's neon on
  what is happening now (the open window, the aimed spot), good and bad only on
  outcomes (a seat's `+`/`−`, a refusal's edge) — never the accent.
- F4: any action that waits on the table goes `.is-busy`, not disabled.

## 5. Talk, activity, refusals (C, A, N)

- `useTalk` + `TalkKey` in the stage's corner column, `TalkSheet` in place of
  the inline `<Chat>`. C5: the shared `Chat` is already a named region, so it is
  not wrapped in a second one.
- `Refusal` at the table, `.play__error` on setup and join (N1, N5). `errorKey`
  is already on `useTableSocket`, so a repeated identical refusal shows and
  sounds twice (N3), and a dropped connection does not pop over the board (N4).
- History stays a thin strip at both sizes; Winners folds into the activity
  tab on a phone and keeps its own panel at a desk. Both are boards, not the
  log (A3) — the log is the table's sentences.

### T3 — what it pays, within reach

Roulette has no payout sheet today; the cloth names a bet on the aim label and
that is all. T3 applies, so one is added: a `?` key in the stage's corner
column, opposite the talk key, opening a sheet of what each kind of bet pays —
straight up 35:1 down to the even-money bets — with **the row that matches the
current aim lit**, which is what T3 asks for ("lighting the rows that apply to
what is selected").

Built from `pays(spot)` in `games/roulette/src/spots.ts`, not from a second list
of figures. A sheet that can disagree with the payouts is worse than no sheet;
the cloth already learned this once, when `dressOf` tested for `"2 to 1"` for a
while after the cloth had started saying `"2:1"` and quietly styled nothing.

### The server-side changes: `eventSeq`, and who a taunt can reach

Roulette's `TableView` has `lastEvent` but no counter. That is A4 exactly: *"A
game whose view has no roll-counter equivalent needs one … or repeated
identical events collapse into one line."* Blackjack has `eventSeq`; Roulette
does not.

So, in `games/roulette/src/table.ts`:

1. Add `eventSeq: number` to `TableView` and to the class, bumped from the one
   place `lastEvent` is set — as Blackjack does, so the counter cannot be
   forgotten at one call site.
2. Widen `lastEvent`, which today says only `"No more bets."` and the pocket
   number. Two sentences is too thin for a log. It should also carry a seat
   arriving, a seat leaving, and what a spin paid.

And one more, for K5. `TauntPicker` only offers seats a taunt's chips can
actually reach — not a bot, and not a guest — so it needs `signedIn` on each
seat. Blackjack's `SeatView` carries it (`signedIn: seat.userId !== null`);
Roulette's carries `isBot` but not `signedIn`, so it gains it the same way.

Both are purely additive to the view; nothing existing changes meaning.

## 6. Keys (K1–K5)

`R` same again, `U` undo, `C` clear, each declared on its button with
`aria-keyshortcuts`. No Space binding, for the reason above.

Blackjack's `useBlackjackKeys` (77 lines) is generic but for its shortcut map
and one `.bj__chip` special case. It moves to `table/useTableKeys`, taking the
map and the "clicked piece" selector as arguments, so K3's exclusions and K4's
clicked-versus-tabbed rule are solved once instead of twice. Blackjack's own
hook becomes a thin call into it and keeps its tests.

K5: the taunt picker becomes a key in the controls while the wheel is turning
— the one stretch of a round with nothing to do.

## 7. Where the code lives

| Piece | File |
|---|---|
| Page, felt, phase swap | `apps/web/src/roulette/Roulette.tsx` |
| The cloth and the gesture | `apps/web/src/roulette/Cloth.tsx` |
| Chip keys, custom bet, acts | `apps/web/src/roulette/Controls.tsx` (new) |
| What the said line says | `apps/web/src/roulette/said.ts` (new, pure) |
| What it pays (T3) | `apps/web/src/roulette/HowItPays.tsx` (new) |
| The wheel and its medallion | `apps/web/src/roulette/Wheel.tsx` |
| Sheet | `apps/web/src/roulette/roulette.css` |
| Shared key handling | `apps/web/src/table/useTableKeys.ts` (new, from Blackjack) |
| The counter | `games/roulette/src/table.ts` |

H1: `roulette.css` is imported by `Roulette.tsx` and by `RouletteMockup.tsx`
— both checked before rules are added. H2: every class stays prefixed `rl__`;
the new page-level ones are `rl__in` and `rl__stage`, and both are grepped
before naming. H3: `biome format --write` only the files touched.

**The `/style` gallery shares these components** (`RouletteMockup.tsx` draws the
real `Cloth`, `Wheel` and `Winners`). It has to keep working, and it is the
cheapest way to look at the cloth without a server and a seat. `Cloth` already
takes a `portrait` prop that forces the orientation, which the mockup does not
currently pass; the mockup should pass it as a control, so both orientations
can be checked at any window size.

## 8. Testing

Per section 11, and `CLAUDE.md`'s rule that every bug fix gets a test watched
failing first.

**Stylesheet tests** — a new `roulette.css.test.ts`, for what jsdom cannot see:
the one-screen shell rules, `.rl__stage`'s container sizing, the inherited size
variable (L4), and that every keyframe added has an entry in the sheet's
`prefers-reduced-motion` block.

**The gesture** — press previews without placing; lift places; a slide re-aims
and places at the new spot, not the first; a hold past 500ms takes back instead;
lifting off the cloth does nothing; `pointercancel` does nothing; a right-click
never places on its way to taking off (the bug the current `event.button !== 0`
guard already fixes, kept under test).

**The custom bet** — below `MIN_CHIP`; above the cap; a figure with commas;
formatting on blur; the latch releasing when the cap moves under it.

**The said line** — a table for its pure function, including the empty-bank
line winning over the rest.

**Keys** — each shortcut fires; each K3 exclusion holds (input, textarea,
select, contenteditable, dialog; Ctrl/Alt/Cmd; a repeat; a button that could not
be pressed); a clicked piece hands keys to the table while a tabbed-to piece
keeps them, with `:focus-visible` spied true to prove it is not what decides.

**Refusals** — a repeated identical refusal bumps `errorKey`; a dropped
connection does not.

**Activity** — new words add a line; the same words after a new `eventSeq` add a
line; an unchanged broadcast does not; a new table starts fresh.

**T4** — the medallion and the stage say nothing about the pocket while
`phase === "spinning"`, tested against a view that already carries it.

**By hand** — the L8 sizes: 375×560, 375×667, 375×812, 768×1024 and a desk. At
each, `document.documentElement.scrollWidth === clientWidth`, and the chip keys
and the three acts are visible without scrolling the page. Also: a throttled
connection for the busy state, a refusal with the board blurred, and talk opened
on a phone.

## 9. Definition of done

- [ ] Every requirement in sections 1–11 of the requirements met, except K1, K2
      and F2, which the PR names with the reason above.
- [ ] Section 12's shared pieces used, not copied.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` clean.
- [ ] Checked by hand at the L8 sizes, including a signed-in phone.
- [ ] `/style`'s roulette mockup still draws.
- [ ] Every keyframe added has an off switch; every bug fixed has a test watched
      failing first.
