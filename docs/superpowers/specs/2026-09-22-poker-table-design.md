# Poker table — design

Brings the Poker table up to `2026-09-16-table-requirements.md`. Requirement IDs
(`L1`, `K3`, …) refer to that document. `CLAUDE.md` still wins over both.

The shared work in section 12 of the requirements landed with Blackjack
(`errorKey`, `table/` components, `table.css`, `.play--fit`), so this is the
table itself, plus the two pieces still sitting inside `blackjack/` that Poker
needs as well.

## Decisions

| Question | Decision |
|---|---|
| The phone felt | A **horseshoe**: the other seats arc over the top, and the bottom of the felt is yours alone — your cards, your stack, what you are holding. |
| The desk felt | The **full-width oval**, as today. A side column of readout, rules, activity and controls appears only past ~1200px of table. |
| Poker's minimum felt (open question 4) | The 580px floor goes. The felt is sized from the room it has, and the arrangement changes at 560px rather than the size being held up. |
| Keys (open question 1) | **Space** is the lit slab: **Check** when checking is free, **Call** when it is not. **F** folds. **R** raises to whatever the amount control shows. |
| Where the talk key sits (open question 5) | Top-right of the felt, with `?` top-left and the host's key beside it — the felt's corners are free at every size. |
| Host controls | Behind a **Table** key on the felt, as Blackjack's are. The bare "Deal somebody in" row goes. |
| Scope | One PR. The shared moves are two file moves and go in their own commit first. |

---

## Shared first: two pieces leave `blackjack/`

Neither is blackjack's, and copying them would be the thing section 12 exists to
stop.

### `Sheet` moves to `apps/web/src/table/Sheet.tsx`

It is already the generic one — something laid over the table on purpose, closed
by Escape and the scrim, returning focus to the key that opened it. Only its
`className` prop names blackjack: `"bj__sheet--felt" | "bj__sheet--page"` becomes
`"sheet--felt" | "sheet--page"`, with the rules moving from `blackjack.css` to
`table.css`. Blackjack keeps its look by keeping `bj__sheet--felt` as a second
class where it needs one.

### The key handler becomes `apps/web/src/table/useTableKeys.ts`

`useBlackjackKeys` is generic apart from two things: its `SHORTCUTS` map and the
`.bj__chip` rule in `K4`. Both become arguments:

```ts
useTableKeys(root, {
  shortcuts: { " ": "Space", f: "F", r: "R" },
  // What a pointer going down inside hands its keys to the table.
  holds: ".bj__chip",
})
```

Everything else stays exactly as it is, because it is already right: press the
button on screen rather than call what it calls, so a disabled or busy button is
a key that does nothing; ignore repeats and modifiers; ignore inputs and
dialogs; and remember what a pointer last went down on rather than asking
`:focus-visible`, which Chrome answers wrongly for a clicked button the moment a
key goes down on it.

Blackjack's own tests move with it and are re-pointed; the hook's behaviour does
not change, so no test should need editing beyond its import.

---

## Server: `eventSeq` (A4)

`games/poker`'s view gains `eventSeq: number`, bumped wherever `lastEvent` is
set, exactly as `games/blackjack/src/table.ts` does it. Without it the activity
log cannot tell one broadcast repeated from the same sentence said twice — and
at a poker table "Ola checked" twice running is the commonest pair of lines
there is.

Tested in `games/poker/src/table.test.ts`: two identical events bump it twice;
a broadcast that reports nothing new does not.

---

## Layout (L1–L8)

### The page is the window (L1, L2)

The page wears `.play--fit`, as every fitted table does. `.play--poker` stays
alongside it, but only for the width rules the nav bar keys off — a felt that
widens takes the bar with it. The page is a flex column; the felt is the only
part that flexes; the readout above and the controls below take their own
height.

This deletes `--spare: calc(100dvh - 470px)` and the `max-width` arithmetic hung
off it. That variable is a guess at the height of everything that is not the
felt, written as a number, and it has been wrong twice already — once when the
hand-reading pill was added and once when the controls grew a row. A flex row of
`minmax(0, 1fr)` is the same idea measured rather than guessed, and chat leaving
the page (below) is what finally makes it affordable.

### One markup, three arrangements (L5)

Seats stop being placed by React. `seatAt()` currently hands each seat a `--cos`
and a `--sin`, which fixes the *arrangement* in JavaScript and leaves the
stylesheet only the radius. Instead each seat carries what it actually knows —
which seat it is and how many there are — and the angle is computed in CSS:

```css
.pk__seat {
  --angle: calc(90deg + (var(--seat) / var(--of)) * 360deg);
  transform: translate(
    calc(cos(var(--angle)) * var(--across)),
    calc(sin(var(--angle)) * var(--down))
  );
}
```

Which is what lets a container query change the arrangement rather than only the
sizes:

- **Under 560px — the horseshoe.** Your own seat is pinned to the bottom centre
  and the others spread over an arc from 150° to 390°, centred so the shape
  degrades correctly as seats empty:
  `--angle: calc(150deg + ((var(--seat) - 0.5) / (var(--of) - 1)) * 240deg)`.
  At ten seats that puts the nine others between 163° and 377°; at two it puts
  the one other at the top, where an opponent belongs. Somebody watching has no
  seat to rotate to, so the table's first seat takes the bottom and the rest
  arc over it — the same rule, with nobody's seat being theirs.
- **560px to ~1200px — the full oval**, as the formula above, across the whole
  width of the page. This is the laptop case, and it is why the side column
  cannot start at the requirements' suggested 760px: blackjack seats five along
  an arc, but ten round an oval squeezed to 760 is the collision the current
  stylesheet ties itself in knots to avoid.
- **Past ~1200px of table — the oval and a side column**, readout, rules,
  activity and controls on the right. At the page's 1600px cap the oval is still
  about 1,250px across, which is wider than a 1280 laptop's felt is today, so
  the column costs nothing where it appears.

Below 560px the chip ring stays off the cloth — three concentric rings do not fit
across 375px, and that reasoning is unchanged — but the stake is no longer
silent: it reads on the seat's own plate, and a swept stake animates from the
plate to the pot rather than from a ring that is not there.

### Sized from the felt, not from the window (L3, L4)

The felt becomes `container: pk / size`, and every piece on it — cards, faces,
plates, the board — is sized from both its axes, `clamp(…, min(…cqi, …cqh), …)`.
A short phone then shrinks the cards rather than pushing Fold under the fold,
which is the whole point of `L3`. Sizes are set on the container only, never
re-declared on the piece (`L4`), and a stylesheet test guards it — this is the
exact bug that once made every Greed die a fixed 56px.

What comes back as a result: on a phone the other seats keep their faces, their
card backs and their stake. Today all three are deleted at 560px to buy room the
felt did not have. With chat off the page and the felt taking the window, it
does.

### Nothing sideways (L6, L8)

Checked by hand at 375×560, 375×667, 375×812, 768×1024 and a desk, with
`document.documentElement.scrollWidth === clientWidth` at each, and the main
action visible without scrolling.

---

## Seats (T1)

The seat keeps everything it has — the avatar ringed in the player's colour, the
turn clock round the face, the speech bubble keyed on the moment it was said,
the dealer and blind marks, the won mark — and gains nothing. It already meets
`T1`: the acting seat is lit in the room's neon, your own is outlined in
`--gr-color-chip-dim`, and a folded or away seat is dimmed rather than hidden.

What changes is that the seat is now a plate at every size rather than a plate on
a phone and a loose stack of text at a desk.

---

## Readout (T2)

New, and the one piece the table has never had: the figure this decision is
about, big, with its supporting figures beside it and the turn clock draining
along its top edge.

- On your turn: **`200 to call`**, with the pot, what you have left, and the
  seconds against you.
- Waiting on somebody else: what the table is waiting for, and for how long.
- Between hands: what the table is waiting on — another player, or the next hand.

It is a strip above the felt on a phone and on a laptop, and moves into the side
column past 1200px — the same component either way, placed by the grid.

The hand you are holding joins it at a desk. On a phone it stays where it is,
under the felt and over the controls, because it is read in the same glance as
the buttons.

---

## Rules (T3)

`Rankings` is already the right thing and stays. It moves inside the shared
`Sheet` behind the `?` key on the felt, and appears as a side-column panel past
1200px. The rows light for the hand you are actually holding, which the
evaluator already says.

---

## Controls (K1, F1–F5) and the amount (S2, S5)

The bottom row of the table at every size: secondary keys left, one lit slab
right, at least 52px tall.

- `pk__act` → `.slab` for the lit one and `.key` for the rest. **One lit thing**
  (`F2`): Check when checking is free, Call when it is not — never Call and Raise
  both.
- `pk__prebtn` (the decide-in-advance group) → `.lamps` / `.lamp`, which is what
  that group has always been.
- `pk__step` and `pk__slice` → `.key`. The pot fractions stay exactly as they are,
  including `sliceTo`'s measuring against the pot *after* the call.
- The figure stays on the key it is about (`F5`): "Call 200", "Raise to 600",
  "Sit down with 20k".
- `.is-busy` on the press, not `disabled` (`F4`).
- **A typed figure** (`S2`), which is the one thing the raise control is missing:
  the same number in a box, shown as typed, committed on Enter or blur, held to
  the cap, nothing typed keeping what was there. The slider keeps `--at` and its
  300ms rest. The cap is a courtesy; the server still refuses (`S3`).

---

## Keys (K2–K4)

**Space** presses the lit slab — Check, or Call. **F** folds. **R** raises to
whatever the amount control shows, which is the only amount it could mean.

Space is deliberately not the raise. The lit slab is the stay-in-the-hand action,
so a stray press can cost a call but can never move a stack; putting chips in
over the odds always takes a deliberate press.

Declared on the buttons with `aria-keyshortcuts` and pressed through
`useTableKeys`, so every `K3` exclusion — inputs, dialogs, modifiers, repeats,
disabled and busy buttons — holds for free. Poker passes no `holds` selector:
that argument exists for a piece you click and then press Space at, which is
blackjack's chip tray, and poker has nothing of the kind. Typing in the amount
box is already somebody else's keys by `K3`, which is what stops a typed **f**
folding the hand.

---

## Host tools

A **Table** key on the felt beside `?`, open to the host only, in a `Sheet`:
seats taken of the maximum, whether the table is listed, and — at a for-fun
table — the three bot buttons. The felt keeps no host row of its own.

Hiding the key is a courtesy; the server refuses a bot at a chips table whatever
the browser shows, and that is the rule. This does not change.

---

## Talk, activity, refusals (C, A, N)

- `<Chat>` leaves the page. `TalkKey` in the felt's top-right corner carries the
  unread count; `TalkSheet` opens over the table and stops short of the controls
  (`C1`–`C3`). One landmark, so the shared `Chat` is not wrapped in a second
  region of its own name (`C5`).
- `.play__event` goes. `useActivity({ code, text: lastEvent, seq: eventSeq })`
  builds the log: the talk sheet's second tab on a phone, its own side-column
  panel at a desk (`A1`, `A2`). The felt's own record — the board, the seats,
  the won line — stays where it is (`A3`).
- `.play__error` at the table becomes `Refusal` over the blurred cloth, with the
  `refused` cue and `errorKey` behind it (`N1`–`N3`). A dropped line is not a
  refusal (`N4`), and the lobby and setup pages keep the strip (`N5`).
- Where the client already knows — a raise over your stack — it is said in place
  rather than left for the server to refuse (`N6`).

---

## Taunts (K5)

The picker joins the controls as a `.key` on the right while somebody else is
deciding, and `TauntStage` goes over the felt. The optimistic cost comes off the
corner balance on the press and is given back if the throw is refused, exactly as
Blackjack does it — `useTableSocket` already exposes `taunt`, `landed` and
`stakes`, so there is no hook work.

---

## Files

`Poker.tsx` is 1,242 lines and holds the page, the felt, the seat, four states of
the controls and the lobby. It splits the way `blackjack/` is split:

| File | What it is |
|---|---|
| `Poker.tsx` | The page: routing, the refusal, the lobby, the taunt stage |
| `Felt.tsx` | The cloth: seats, board, pot, the sweeps, the corner keys |
| `Seat.tsx` | One seat |
| `Readout.tsx` | `T2`, and its model function |
| `Controls.tsx` | The bottom row in each of its states |
| `Amount.tsx` | The dial, the slider, the presets, the typed figure |
| `PokerSheet.tsx` | The host's table sheet |
| `Rankings.tsx` | Unchanged, rendered into a `Sheet` or a panel |

`useIntent`, `useTableSound` and `felt.test.ts` stay as they are.

---

## Stylesheet

`poker.css` keeps its job — it draws the real table and `/style`'s mockup from
one sheet, and that stays true, so `PokerMockup.tsx` is updated in step and shows
the horseshoe as well as the oval. The classes stay `pk__`-prefixed (`H2`), the
sheet is imported by its component (`H1`), and only touched files are formatted
(`H3`).

Every keyframe added or moved gets its off switch in the sheet's own
`prefers-reduced-motion` block (`M1`), and the new scrolling boxes — the activity
panel — wear the room's bar (`M2`).

---

## Tests

New `apps/web/src/poker/poker.css.test.ts`, for what jsdom cannot see:

- the fitted shell rules and the single flexing row (`L1`, `L2`);
- the felt is a size container and pieces are sized from both axes (`L3`);
- no piece re-declares a size variable it should inherit (`L4`);
- both seat arrangements exist, with the horseshoe under a container query
  (`L5`);
- every animated selector appears in the reduced-motion block (`M1`).

Alongside:

- **Seat angles** — the mapping at ten seats, at two, and at the boundary,
  asserted as numbers rather than as a snapshot.
- **Keys** — each of Space, F and R fires; each `K3` exclusion holds; a clicked
  amount box keeps its own keys while a tabbed-to button keeps Space, with
  `:focus-visible` spied true to prove it is not what decides.
- **Activity** — new words add a line; the same words after a new `eventSeq` add
  a line; an unchanged broadcast does not; a new table starts fresh.
- **Refusal** — a repeated identical refusal bumps `errorKey`; a dropped
  connection does not.
- **Amount** — a typed figure over the cap is held to the cap; nothing typed
  keeps what was there; Enter and blur commit.
- **`games/poker`** — `eventSeq` bumps per action.

`Poker.test.tsx` is 762 lines and follows the split into files beside each piece.
Nothing it asserts about the rules changes; what changes is where it looks.

By hand: the `L8` sizes, a throttled connection for the busy state and the
face-down bargain, a refusal with the cloth blurred, and talk opened on a phone.

---

## Not in scope

- **The rules of the game.** No change to `games/poker` beyond `eventSeq`.
- **The money.** Poker is players against each other; no bank, no cap, no float,
  and nothing here goes near the economy.
- **The protocol.** `game:action` carries the same envelope.
- **Bots.** They stay refused at every table that plays for chips, server-side.
- **The other tables.** Roulette, Two-Up and Death Roll are still on the old
  page model; this does not touch them.
