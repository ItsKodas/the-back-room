# Fittings — design

A component library for the building's pages, taken from the two screens that
already feel finished: the slot machine and the leaderboard. The approved
mockup is the artifact "Back Room Fittings"
(https://claude.ai/artifact/5gfyci3F7vh3DA57cWeu12); where this document and
the mockup disagree about how something looks, the mockup wins, and where they
disagree about what is in scope, this document does.

## Why

The pages are built from outlines: 1px borders round nearly empty boxes, and
2–4px corners on everything. The slot machine and the leaderboard are built
from surfaces instead, and that is the whole of the difference people notice.

The language, in one sentence: **filled, not outlined — things you press stand
up off the panel, things you choose sink into it, and the one thing that
matters on a screen is lit.**

Two meanings in the palette stay exactly as rationed as they are today:
glowing is *happening now*, gold is *money*. No new colour is added anywhere.

## Scope

**In:** pages. The nav and its controls, the front page, the table setup and
join screens, the list of open tables, the pre-game lobby, sign-in gates, the
profile (including redeem and send), the admin desk and its dialogs, the
leaderboard, and the "taken" retry screen.

**Out:** anything on a felt. Blackjack's felt and betting panel, Greed's table,
Death Roll, Two-Up, the tip jar's play area, chat and taunts, and the slot
machine itself keep what they have. A later pass can bring them over; nothing
in this design should make that harder.

This boundary is why the library is **new classes rather than a restyle of the
old ones.** `.btn`, `.panel`, `.variant` and `.bots` are all used on felts as
well as pages (`blackjack/Blackjack.tsx` `btn--move`, `deathroll/DeathRoll.tsx`
`dr__roll`, `game/Table.tsx`), and `blackjack.css`, `deathroll.css`, `taunt.css`
and `admin.css` all lean on `.btn`'s current box. Restyling `.btn` in place
would repaint every table. So pages move to the new classes, tables keep the
old ones, and the old rules are deleted only once nothing uses them.

## Tokens

Added to `packages/ui/src/tokens.css`, and to the approved set in
`tokens.test.ts`. None is a colour, so `tokens.ts` gains nothing and no room's
`theme.css` changes.

| Token | Value | For |
|---|---|---|
| `--gr-radius-key` | `12px` | anything pressed |
| `--gr-radius-cab` | `18px` | cabinets |
| `--gr-radius-pill` | `999px` | toggles, sorts, tags, the player pill |
| `--gr-press` | `6px` | how far a slab travels |
| `--gr-spring` | `cubic-bezier(0.16, 2.2, 0.4, 1)` | a release — the spin button's |
| `--gr-settle` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | a thing sliding into place |
| `--gr-bezel` | `inset 0 0 0 1px rgb(255 255 255 / 0.2)` | light round the rim of glass |
| `--gr-lip` | `inset 0 1px 0 rgb(255 255 255 / 0.08)` | a top edge catching light |
| `--gr-sink` | `inset 0 2px 6px rgb(0 0 0 / 0.55)` | a recess |
| `--gr-glass` | `linear-gradient(180deg, rgb(255 255 255 / 0.42) 0%, rgb(255 255 255 / 0.13) 34%, rgb(255 255 255 / 0.02) 48%, transparent 60%)` | glass over a lit screen |
| `--gr-scan` | `repeating-linear-gradient(0deg, rgb(255 255 255 / 0.028) 0 1px, transparent 1px 3px)` | a screen's scanlines |

`--gr-radius-sm`, `--gr-radius-md`, `--gr-edge-*` and `--gr-lift-*` stay; the
felts still use them.

## Where it lives

- `apps/web/src/fittings/fittings.css` — every rule below, imported in
  `main.tsx` straight after `game/game.css` so a page's own sheet can still
  place a fitting without fighting it on weight. The route stylesheets
  (`admin.css`, `leaderboard.css`, `net.css`) load after it, so a page rule
  there beats a fitting on an equal-weight tie for free. `game.css` is the one
  exception, since it loads *before* fittings.css: a page rule in it on an
  element that also wears a fitting class has to be compounded with the
  fitting's own class (`.row.open-table`, not `.open-table`) to win that tie,
  or fittings.css quietly wins it instead.
- `apps/web/src/fittings/` — the few React components that exist because the
  part has behaviour, not because it has markup (see below).
- `apps/web/src/style/Fittings.tsx` — a section in the `/style` gallery showing
  every part in every room, the way the mockup does. It is the reference a
  later table pass works from.

The rest of the library is classes, which is how this repo already works.
`.cab` and `.screen` are the slot machine's and `.cabinet` is the front
page's, which is why the mockup's panel ships as `.housing`, its screen as
`.readout`, and its lit button as `.slab`.

## The parts

Each is exactly as drawn in the mockup; this lists what each is *for*, which
is what decides where it goes.

### Keys

- **`.slab`** — the lit button. A dark well, a screen of the room's neon moving
  slowly behind glass, and a solid `--gr-color-neon-deep` slab underneath.
  Down in 55ms, back up on `--gr-spring`. **One per housing**: the thing that
  housing is for. Modifiers `--wide`, `--small`.
  - `:disabled` is *unable*: the screen goes out and the slab is already down.
  - `.is-busy` is *waiting on the server*: held down, still lit, the light
    moving faster. It is set on the press, not on the acknowledgement, and
    cleared when the answer or a refusal lands.
- **`.key`** — the dark raised cap, for every other action. Modifiers `--wide`,
  `--small`, `--icon` (a square cap with an SVG, replacing `.iconbtn`),
  `--danger` (a press that cannot be taken back, in the outcome colour).
  `.quiet--wide` for a full-width one.
- **`.quiet`** — words that act: cancel, back, keep it open.
- **Sign-in with Discord** keeps Discord's blurple as `.slab--discord`, which
  swaps the screen's colours and nothing else.

### Choosing

- **`.seg`** — one question, two or three answers, a lit thumb sliding between
  them on `--gr-settle`. Needs a component (`Seg.tsx`) to place the thumb.
- **`.lamps` / `.lamp`** — numbers sunk into the panel, the lit one in play.
  Seats and betting window. `SeatCount.tsx` renders these. `.lamp--chips`
  lights gold, for a number that is chips (a buy-in); `.lamp--word` is a
  labelled toggle (a house rule). Lit is `aria-checked` or `aria-pressed`,
  whichever the control really is.
- **`.plates` / `.plate`** — a choice with a sentence under it; a lamp lights
  on the chosen one. What game variants and "For chips / For fun" become.
- **`.sort`** — the leaderboard's filter pill, promoted so the leaderboard and
  anything else that orders a list share it. `.board__sort` goes.

Every one of these is a real `<button>` with `aria-pressed`, or `role="radio"`
with `aria-checked` inside a `radiogroup`, as in the mockup.

### Typing

- **`.entry` / `.label` / `.input` / `.hint`**, with `.entry--bad` for a
  refused value. The wrapper is `.entry`, not `.field`: `.field` is already a
  class in `game.css`, and stayed the felts' and the chat box's own until it
  was deleted from every page that had shared it with this sheet.
  `.field__input` alone survives, because the in-game chat still wears it.
- **`.lcd`** — the table code on a scanlined screen, one cell per character,
  the example code showing faint until typed over. A real `<input>` sits over
  the cells so paste, autofill and screen readers behave as they do today —
  `.lcd__input` is set to 16px so a focused field this transparent still
  stops iOS Safari zooming the page in. Component: `CodeScreen.tsx`, used by
  `TableSetup.tsx` and `Play.tsx`'s join.

### Containers

- **`.housing`** — the page's main panel, lit from above like the machine.
  `__head` (the lit strip with a label), `__body`, `__foot` (where the slab
  goes). Replaces `.panel` on pages.
- **`.well`** — a recess inside a cabinet for things that belong together.
- **`.rows` / `.row`**, `.row--you` — the leaderboard row, for any list of like
  things. The open-tables list becomes rows with a lit code, a tag and seat
  pips.
- **`.readout`** — one figure on a screen (bank balances on the admin desk).
  Gold if the figure is chips, as always.
- **`.tag`**, `--live`, `--chips` — a small state. Only `--live`'s lamp moves,
  and only while the thing is live.
- **`.notice`**, `--good`, `--bad` — the table or the server saying something.
- **Dialogs** are a `.housing` with `role="dialog"`; `admin/dialogs.tsx`'s
  `Dialog` keeps its behaviour and swaps its classes.

**`.stake`** from the mockup is not built yet. Nothing on a page chooses a
stake; it belongs to the table pass.

## Rollout

Page by page, each one leaving the site working:

1. Tokens, `fittings.css`, the three components, the gallery section.
2. Nav: player pill, icon keys, sign-in.
3. Table setup, join, open tables, pre-game lobby, sign-in gates — the screens
   in the user's screenshots, and every game's copy of them at once, since they
   are one component.
4. Front page.
5. Profile, redeem, send.
6. Admin desk and its dialogs.
7. Leaderboard onto `.sort`. Its rows stay `.board__row`: they are what
   `.row` was taken from, and their seven-figure grid is the board's own.
8. Delete the `game.css` rules nothing references any more, confirmed by grep
   rather than by eye.

## Motion and the building's rules

- Every keyframe and transition in `fittings.css` is off under
  `prefers-reduced-motion`, and every state still reads without them: lit vs
  unlit, down vs up.
- One motion per thing. A slab's press and its busy shimmer are on different
  layers (`transform` on the button, `background-position` on `::before`), so
  a press during a shimmer does not restart either.
- The only loops are the slab's slow light (it is lit — that is true the whole
  time), the busy shimmer (only while waiting) and `.tag--live` (only while
  live).
- Nothing here waits on the server to show a press. `.is-busy` exists so a page
  can show one at once.
- Thumb-sized throughout: `.slab`, `.key` and `.input` are 48px tall, `.lamp`
  44px, `.seg` answers and `.sort` 40px. `.key--small` and `.slab--small` are
  38px and appear only inside rows and dialogs, never as a screen's main
  action. Nothing in the sheet is wider than 375px outside a media query.

## Testing

- `tokens.test.ts`: the new tokens are in the approved set.
- `fittings/fittings.css.test.ts`, in the style of the existing CSS tests:
  imported in `main.tsx`; every `animation` and `transition` is switched off
  under reduced motion; no fixed `width`/`min-width` over 375px outside a media
  query; `.slab.is-busy:disabled` outranks `.slab:disabled` on selector weight
  rather than on source order.
- `Seg.test.tsx`: exactly one answer is pressed, and pressing another moves
  `aria-pressed`.
- `CodeScreen.test.tsx`: typing uppercases and strips to five of `[A-Z0-9]`,
  the cells show it, and paste works.
- Existing page tests (`TableSetup`, `Leaderboard`, admin) keep passing with
  queries updated only where they reached for a class name.
- `style/stylesheets.test.ts` already parses every sheet, so `fittings.css` is
  covered by it on arrival.
- By hand, and recorded in each step's commit: every page at 375px and at
  desktop width, in every room, under a throttled connection for the busy state.
