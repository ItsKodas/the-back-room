# Tables — requirements

What every table in the building has to meet, taken from the Greed table as it
stands after #61 and #62. Use it as the brief and the checklist when bringing
Blackjack, Poker, Roulette, Two-Up and Death Roll up to the same standard, and
for any table added later.

This sits under `CLAUDE.md` (the money rules and "how it should feel" always
win) and beside the fittings spec (`2026-09-15-fittings-design.md`), which says
how the parts look. This document says what a table must *do* with them.

**Reference implementation:** Greed. Where a requirement names a file, that is
where the working version is.

| Piece | File |
|---|---|
| Table layout | `apps/web/src/game/Table.tsx`, `apps/web/src/game/greed.css` |
| Scores as a race | `apps/web/src/game/Lanes.tsx` |
| Talk key, sheet, lobby panel, unread count | `apps/web/src/game/TalkSheet.tsx` |
| Activity log | `apps/web/src/game/Activity.tsx` |
| Refusal overlay | `apps/web/src/game/Refusal.tsx` |
| Refusal counter | `errorKey` in `apps/web/src/game/useRoom.ts` |
| Stake picker | `apps/web/src/game/Stake.tsx` |
| Page wiring | `apps/web/src/game/Play.tsx` |

Requirement IDs (`L1`, `T2`, …) are there so a PR can say which it meets.

---

## 1. Layout — one screen

The whole game fits the window with nothing to scroll, on a phone as on a desk.

- **L1 — The page is the window.** At the table, `.shell` is exactly `100dvh`
  and the page's row is `minmax(0, 1fr)`; the page itself is a flex column
  with `min-height: 0`. Scope it with `:has(> .play--<game>)` so lobbies and
  join pages keep scrolling. (`greed.css`, "the window")
- **L2 — Only the play area flexes.** The table is a grid whose rows are
  `auto` except one `minmax(0, 1fr)`: the felt, wheel, reels or cloth. Scores,
  readout and controls take their own height.
- **L3 — Size pieces from the space they have.** Make the play area a
  `container: <name> / size` and size game pieces from both its width and its
  height (`min(…cqi, …cqh)`), clamped. A short phone shrinks the pieces rather
  than pushing the controls below the fold.
- **L4 — Let the size inherit.** Set a piece's size variable on its container
  only. A piece that declares the same custom property on itself beats the one
  it inherits — this is how every Greed die was once a fixed 56px. Guard it with
  a stylesheet test (`greed.css.test.ts`).
- **L5 — One markup, two arrangements.** Phone: a single column. Past 760px of
  table (`@container`, not `@media`): the play area on the left and a side
  column (readout, card, activity, controls) on the right. Pieces that can go on
  one line when there is room do (Greed's dice: one row once the felt is 480px).
- **L6 — Nothing sideways.** No element wider than the window at 375px. The
  shell's column is `minmax(0, 1fr)` so one wide child cannot push the page
  (`shell.css.test.ts`). Anything that must be wide scrolls in its own box.
- **L7 — The bar fits a signed-in phone.** Nothing game-specific goes on the
  nav bar; at the table the bar's side padding matches the table's edges on a
  phone (`greed.css`, `@media (max-width: 640px)`).
- **L8 — Check these sizes by hand before calling it done:** 375×560 (a short
  phone in Safari), 375×667, 375×812, 768×1024 and a desk. At each:
  `document.documentElement.scrollWidth === clientWidth`, and the main action is
  visible without scrolling.

## 2. Built from the fittings

- **F1 — The parts, not the old ones.** `.slab` for the one lit main action,
  `.key` for every other action, `.readout` for a figure on a screen, `.lamp` /
  `.lamps` or `Seg` for choices, `.housing` and `.well` for panels, `.tag` for a
  small state. No new `.btn`, `.btn--ghost` or `.panel` on a table; retire the
  old ones as each table moves over.
- **F2 — One lit thing.** One `.slab` per state of the controls. Two lit
  buttons have no obvious one.
- **F3 — Colour keeps its meaning.** Gold only on chips (a balance, a stake, a
  pot). The room's neon only on what is happening now (whose turn, what is held,
  the main action). Good and bad only for outcomes (a bank total, a bust, a
  refusal's edge) — never the accent.
- **F4 — Busy is not disabled.** The main action goes `.is-busy` on the press
  and stays down until the table answers or refuses. Disabled means it cannot be
  pressed at all.
- **F5 — Say it on the key it is about.** A price, a count or a chance sits on
  the button it describes (Greed: "Roll 4 · 16% bust", "Bank 600").

## 3. The table itself

- **T1 — Scores that answer "by how much".** Where the game is a race to a
  target, show lanes with the target, any entry mark, and a ghost where the
  current action would put the player (`Lanes.tsx`). Otherwise, seat plates.
  Either way:
  - the seat whose turn it is is lit in the room's neon;
  - your own seat is outlined in `--gr-color-chip-dim`, as the leaderboard does;
  - a seat sitting out or gone is dimmed, never hidden, with its state said
    (visibly at a desk, to a screen reader on a phone).
- **T2 — A readout of what this turn is worth.** The one figure the player is
  deciding about, big, with its supporting figures beside it as one block, and
  the turn clock draining along the readout's top edge.
- **T3 — Rules within reach, not in the way.** A game's scoring or payout
  table sits behind a `?` key on the play area on a phone and in the side column
  at a desk, lighting the rows that apply to what is selected.
- **T4 — Pieces in the air are unreadable, not invented.** Until the server
  answers, a thrown die, a dealt card or a spinning reel shows a blur or its
  back — never a face the server has not sent. It turns over sharp when the
  answer lands. (`greed.css`, `.die--rolling`)
- **T5 — The big moments get one lit moment.** A rare result earns a banner and
  a single motion (Greed's `$GREED`); a loss gets a stamp. Once, not looped.

## 4. Controls and keys

- **K1 — Main actions under the thumb.** The controls are the bottom row of the
  table: secondary key on the left, lit main action on the right. At least 52px
  tall.
- **K2 — Space is the turn's main action.** Roll, deal, spin, throw — whatever
  the lit slab does. Another single letter for the secondary action (Greed:
  **B** banks). Declare both on the button with `aria-keyshortcuts`.
- **K3 — Keys never fight the page.** A shortcut does nothing:
  - in an `input`, `textarea`, `select`, `contenteditable`, or inside a
    `[role="dialog"]`;
  - with Ctrl, Alt or Cmd held (those are the browser's);
  - on a repeat from a key held down;
  - when the button it stands for could not be pressed.
- **K4 — A clicked piece hands keys to the table; a tabbed-to piece keeps
  them.** Remember which piece a pointer last went down on (`pointerdown`,
  forgotten on the next `focusin` elsewhere). Do **not** ask `:focus-visible` —
  Chrome reports a clicked button as keyboard-focused the moment any key goes
  down on it. A keyboard player must still be able to press pieces with Space.
- **K5 — Taunts while you wait.** The taunt picker is a key in the controls
  (`openClassName="key"`) while somebody else has the turn, on the right so its
  panel opens on screen.

## 5. Talk

- **C1 — Talk is opened, never pushed.** No inline chat panel on a table. A
  talk key pinned to a corner of the play area (Greed: top-left of the felt,
  opposite `?`) opens `TalkSheet`.
- **C2 — The key counts.** It carries the number of lines somebody *else* said
  since talk was last open (`useTalk`), `9+` past nine, and says it to a screen
  reader.
- **C3 — The sheet keeps the game in view.** On a phone it rises from the
  bottom and stops short of the scores; at a desk it is a drawer from the right.
  Escape and the scrim close it; focus returns to the key.
- **C4 — The lobby wears the same dress.** Before the game, talk is a panel on
  the page (`TalkPanel`) styled as the sheet is.
- **C5 — One landmark.** Do not wrap the shared `Chat` (already a region named
  "Table talk") in a second region of the same name.

## 6. Activity

- **A1 — What happened is kept, not flashed.** Drop the `.play__event` strip.
  Build a log from the table's `lastEvent` with `useActivity`: a new line when
  the words change, or when the action counter moves on (the same words twice
  running are two events); nothing when the counter resets; a fresh log at a new
  table; capped at 100.
- **A2 — Where it lives.** At a desk, its own panel in the side column. On a
  phone, the second tab of the talk sheet ("Talk / Activity"). Newest at the
  bottom, kept scrolled there inside its own box, the newest line brighter.
- **A3 — Game boards stay.** A table's own record of results — Roulette's
  pockets, Two-Up's throws, Death Roll's rolls — is a board, not the activity
  log, and keeps its place. The log is the table's sentences.
- **A4 — The counter the log keys on.** A game whose view has no roll-counter
  equivalent needs one (a sequence number bumped on every action the table
  reports), or repeated identical events collapse into one line.

## 7. Refusals and notices

- **N1 — A refusal takes the middle of the board.** At the table, the server
  saying no (`room:error`, a refused ack, a refused taunt) shows as `Refusal`:
  a card centred over the play area with the board blurred behind it, edged in
  the bad colour, with a small shake on arrival.
- **N2 — It is heard.** It plays the `refused` cue — the interface's error
  sample, quieter than a loss.
- **N3 — Every no counts.** The socket hook exposes `errorKey`, bumped on every
  refusal, so the same words twice show and sound twice and the 4-second clear
  restarts. A refusal already standing when the table appears shows but does
  not sound.
- **N4 — Trouble with the line is not a refusal.** A dropped connection sets
  the error text without bumping `errorKey`; the nav's connection light already
  says it. It does not pop over the board.
- **N5 — Pages keep the strip.** Join, lobby and setup pages show errors as
  `.play__error`, as now.
- **N6 — Say it before the press when the client knows.** A limit the client
  can already see (Roulette's bet cap, a stake over the balance) is said in
  place, not left for the server to refuse.

## 8. Stakes

- **S1 — For fun, or a figure.** A `For fun` lamp, a slider from 1 to the
  lesser of the host's balance and the table's ceiling, and the same figure in
  a box to type (`Stake.tsx`).
- **S2 — The figure is the player's, so it moves at once.** Show it on the press
  or drag; send it once the slider rests (300ms) or the box is committed (Enter
  or blur). Nothing typed keeps what was there; a typed figure over the cap is
  held to the cap.
- **S3 — The server stays the rule.** The slider's cap is a courtesy. The
  server still validates the figure and still refuses to deal when a seat cannot
  cover it; the client never enforces either.
- **S4 — Gold, with the pot said.** Every figure here is gold; under it, the
  pot and what everyone puts in when the game starts.
- **S5 — In-hand betting may add presets.** Games that bet during play
  (Poker's raise, Blackjack's chips) keep their own controls, but a slider there
  meets S2, and named sizes (Poker's ½ pot, Pot, All-in) are encouraged.

## 9. Motion, sound and small things

- **M1 — Everything in `CLAUDE.md` still applies.** Short, physical, one motion
  per thing, every keyframe with an off switch that still says everything.
  Stylesheets add their animated selectors to their own `prefers-reduced-motion`
  block.
- **M2 — Scrolling boxes wear the room's bar.** Thin, dark, rounded, no arrows.
  Style `::-webkit-scrollbar`, and put `scrollbar-width` / `scrollbar-color`
  inside `@supports not selector(::-webkit-scrollbar)` — Chrome lets the
  standard properties win and draws its system bar with arrows.
- **M3 — Lit buttons stay inside their corners.** Fixed in `fittings.css`
  (`.slab::before { border-radius: inherit }`); any bespoke lit control with
  layered pseudo-elements needs the same.

## 10. Stylesheet hygiene

- **H1 — A table's sheet is imported by its component**, and the import is
  checked (`grep` the filename) before rules are added.
- **H2 — Class names are the table's own.** `game.css` is global and carries
  several pages: the front room and Greed's lobby once both used `.lobby`, and
  it was fixed twice from both ends. Prefix a table's classes; grep before
  naming.
- **H3 — Formatter.** Biome's formatter is off for CSS; keep sheets tidy by
  hand. `biome format --write` only the files touched, never `biome check
  --write`.

## 11. Testing — what each table's PR must include

- **Stylesheet tests** for the layout rules that jsdom cannot see: one-screen
  shell rules, container sizing, inherited size variables, reduced-motion
  coverage.
- **Key handler tests:** each shortcut fires; each K3 exclusion holds; a
  clicked piece rolls while a tabbed-to piece keeps its key (spy
  `:focus-visible` true to prove it is not what decides).
- **Refusal tests:** a repeated identical refusal bumps `errorKey`; a dropped
  connection does not.
- **Activity tests:** new words add a line; the same words after a new action
  add a line; an unchanged broadcast does not; a new table starts fresh.
- **Every bug fix gets a test watched failing first** (`CLAUDE.md`).
- **By hand:** the L8 sizes, a throttled connection for the busy state, a
  refusal with the board blurred, talk opened on a phone.

---

## 12. Shared work to do first

Everything below is Greed-only today and every other table needs it. Do it
once, in its own PR, before any table moves over.

1. **`errorKey` in `useTableSocket`** (`apps/web/src/table/useTableSocket.ts`).
   It has `error` and a 4-second clear keyed on `[error]` only. Add `errorKey`
   and a `refuse()` exactly as `useRoom.ts` does, and key the clear on both. The
   `useIntent` hooks that drop a pending move on `[error]`
   (`blackjack/useIntent.ts`, `poker/useIntent.ts`, `deathroll/useIntent.ts`,
   `TwoUp.tsx`) should watch `errorKey` too, or a repeated refusal leaves a move
   hanging.
2. **Move the shared pieces out of `game/`** into `apps/web/src/table/`:
   `TalkSheet`, `Activity`, `Refusal`, `Stake`. Split the shared rules out of
   `greed.css` into a `table.css` imported by those components (talk, activity,
   refusal, scrollbars, the talk-key corner).
3. **A generic one-screen page class.** Replace the `.play--greed` shell rules
   with one every table can wear (e.g. `.play--fit`), keeping Greed's look.
4. **A generic counter for activity** where a game's view lacks one (A4).

`useTableSocket` already exposes `chat`, `say`, `landed`, `stakes` and `taunt`,
so talk and taunts need no hook changes. `TableSetup` is already fittings apart
from one `.panel__note`; the per-game options passed into it are not (Roulette
`.stakes__pick`, Two-Up `.tu__window-pick`, Death Roll `.dr__pick`).

## 13. Per table

Where each stands today (surveyed 2026-09-16), what it needs, and what it does
better than Greed and should keep or share.

| | Blackjack | Poker | Roulette | Two-Up | Death Roll |
|---|---|---|---|---|---|
| One screen (L) | no — scrolls | partial — dvh budget, chat below | no | no — sticky rail | partial — dvh min-height, sticky controls |
| Fittings (F) | no — `.btn`, `.panel` | no — bespoke | no — bespoke | no — bespoke | no — `.btn` |
| Talk sheet (C) | no — inline | no — inline | no — inline | no — inline | no — inline |
| Activity log (A) | no — `.play__event` | no — `.play__event` | no — History board | no — throw Board | no — roll strip |
| Refusal overlay (N) | no | no | no | no | no |
| Shortcuts (K) | none | none | none | none | none |
| Stake (S) | chip buttons | slider, no typed figure | chip tray | chip tray | fixed ante |
| Taunt key (K5) | inline picker | none | none | none | none |
| Reduced motion (M1) | yes | yes | yes | yes | yes |

### Blackjack — `apps/web/src/blackjack/`
- [ ] One screen: dealer, seats and side panel inside a fitted page; stack
      controls above seats on a phone (it already does this — keep it).
- [ ] `.bj__actions` panel and `btn--move` / `btn--ghost` / `btn--wide` moves →
      fittings; one lit slab per state.
- [ ] Chat and TauntPicker out of `.play__talk`: talk key and sheet; taunt as a
      key while others act.
- [ ] `.play__event` → activity log; `.play__error` → `Refusal`.
- [ ] Keys — **to decide:** Space for the main action (deal / ready / stand?)
      and letters for the moves (H hit, S stand, D double, P split?).
- [ ] Chip buttons stay for the in-hand bet; a pre-game table stake, if any,
      meets S1–S4.
- Keep: balance beside the bet, the last-call countdown that locks the chips,
  the bet pile bump.

### Poker — `apps/web/src/poker/`
- [ ] One screen: the `--spare` dvh budget is the right idea; take chat off the
      page so the felt can have the whole height.
- [ ] Check the 580px felt minimum above 561px against L6.
- [ ] Bespoke `pk__act` / `pk__step` / `pk__slice` → fittings where they are
      actions and choices; the felt's own pieces stay bespoke.
- [ ] Inline chat → talk sheet; `.play__event` → activity; `.play__error` →
      `Refusal`. Seat speech bubbles stay.
- [ ] Keys — **to decide:** Space for check/call? F fold, R raise?
- [ ] Raise slider: add a typed figure (S2); keep the pot presets.
- [ ] Taunts: add the picker as a key.
- Keep, and consider sharing: pot-fraction presets, the filled range track via
  `--at`, spoken action cues keyed on the state timestamp (two checks both
  sound), the rankings help sheet.

### Roulette — `apps/web/src/roulette/`
- [ ] One screen: the portrait cloth's `min(78dvh, 680px)` plus the boards and
      chat below it do not fit; decide which boards go behind a key on a phone.
- [ ] Bespoke `rl__chip` / `rl__act` / `stakes__pick` → fittings for actions and
      choices.
- [ ] Inline chat → talk sheet; `.play__error` → `Refusal`. The pocket History
      and Winners boards stay (A3); the table's sentences go to activity.
- [ ] Keep the client-side cap refusal in the Standing line (N6).
- [ ] Keys — **to decide:** Space for "same again"? U undo?
- [ ] Taunts: add the picker as a key.
- [ ] A cue when a chip is placed (it is silent today).
- Keep: the empty-bank line said before anyone presses.

### Two-Up — `apps/web/src/twoup/`
- [ ] One screen: the sticky, safe-area-aware bottom rail already reaches the
      thumb — fit the page so it no longer needs to stick.
- [ ] Bespoke `tu__chip` / `tu__act` / `tu__window-pick` → fittings for actions
      and choices.
- [ ] Inline chat → talk sheet; `.play__error` → `Refusal`. The throw Board
      stays (A3).
- [ ] Keys — **to decide:** Space to throw when you hold the kip?
- [ ] Taunts: add the picker as a key.
- Keep: optimistic stakes that clear on the table's reply or on a refusal (they
  must clear on `errorKey`, not only on `error`).

### Death Roll — `apps/web/src/deathroll/`
- [ ] One screen: replace the guessed `calc(100dvh - clamp(…))` min-height with
      the fitted shell (L1); the roll history strip scrolls in its own box.
- [ ] `.btn dr__roll` / `.btn--ghost dr__pass` / `dr__bot` / `dr__pick` →
      fittings.
- [ ] Inline chat → talk sheet; `.play__error` → `Refusal`; the table's lines
      to activity. The roll strip stays (A3).
- [ ] Keys: Space rolls (the obvious port). **To decide:** P to pass?
- [ ] Taunts: add the picker as a key.
- Keep: the pot figure that counts pending passes, with its one "paid"
  flourish; the countdown digit re-keyed each tick; bots offered under empty
  seats.

### Slots and the tip jar
Not multiplayer tables, so C, A, K5 and S1 do not apply. Worth taking from this
standard when they are next touched: L1–L8 (both are `min-height: 100dvh` and
grow), M2 for the feed lists, K2 (Space to spin), and N1 in place of Slots' own
"The machine says" line only if the machine's screen stops being the better
place for it. Slots' typed custom bet (format on blur, Enter to commit, range in
the placeholder, `aria-live` explainer) is a good model for S2.

---

## 14. Definition of done, for each table

- [ ] Meets every requirement in sections 1–11 that applies, or the PR says
      which it does not and why.
- [ ] Section 12's shared pieces are used, not copied.
- [ ] `npm test`, `npm run typecheck` and `npm run lint` are clean; CI's `check`
      job is green.
- [ ] Checked by hand at the L8 sizes, including a signed-in phone.
- [ ] Every keyframe added has an off switch; every bug fixed has a test watched
      failing first.

## 15. Open questions

1. **Keys per game.** Space is settled as the main action; the letters for each
   game's other moves are proposals above and are yours to choose.
2. **Blackjack's stake.** Is there a table stake before the hand, or is the chip
   bet during the hand the only one?
3. **Roulette on a phone.** Which boards (History, Winners) go behind a key so
   the cloth fits?
4. **Poker's minimum felt.** Keep the 580px floor at tablet widths, or let the
   felt shrink further?
5. **Where the talk key sits** on tables whose play area has no free corner
   (Roulette's cloth, Two-Up's ring).
