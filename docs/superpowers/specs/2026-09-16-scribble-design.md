# Scribble — design

A drawing and guessing game in the manner of skribbl.io: one person draws a
word, everybody else races to guess it. What makes ours its own is a **teams
mode**, in which two teammates draw the same word together on one canvas.

The approved mockup is the artifact "The Scribble Room"
(https://claude.ai/artifact/UTDJnRjJLfxJvbDWssPb8b). Where this document and
the mockup disagree about how something looks, the mockup wins; where they
disagree about behaviour or scope, this document does.

## Decisions

| Question | Answer |
|---|---|
| Stakes | For fun only. No chips move, ever. |
| Bots | None. |
| Modes | Everyone for themselves, or Teams. |
| Teams | 2, 3 or 4, chosen by the host. |
| Who draws in Teams | A pair from one team, both drawing freely at once on one canvas. |
| Who guesses in Teams | Everybody not drawing, from every team, including the drawers' own teammates. |
| Team picking | Players pick between games; no team may be more than one bigger than another. |
| Words | Built-in themed packs, plus the host's own words. |
| Seats | The building's limit of 10. |
| Stroke transport | Batched through `game:action`, relayed without a full broadcast ("option A"). |

### Why for fun only

A guessing game cannot be refereed by a server. Two friends on a voice call can
say the word out loud, and nothing on the table can tell. A chips table would
pay whoever colludes best, which is the economy being a button again. Scribble
therefore sits outside the economy entirely: `forFun` is forced on, there is no
buy-in field, and the adapter's `settle` and `void` move nothing.

### Why no bots

A bot that draws recognisably or guesses plausibly is a project of its own and
would still feel like theatre. A table waits for real people instead.

### Why option A for strokes

`guard()` is the one place every player action is rate-limited and checked, and
the server's own comment says a game with its own route around it could not be
trusted with the same rules. The costly part of an action is not `guard()` —
its checks are map lookups — but the full `view()` per socket that
`broadcast()` sends afterwards. Option A keeps strokes in `guard()` and skips
only that broadcast. A dedicated `draw:*` channel would buy almost nothing per
message, and scaling past one process (rooms are an in-memory `Map`; there is
no socket.io adapter) is the same work either way.

## The table

### Waiting

With nobody playing, a table waits until it has enough people: **2** for
Everyone for themselves, **2 × teams** for Teams. When it does, a **15 s**
countdown starts. Teams are picked during it; when it runs out, anybody who has
not picked goes to the smallest team (earliest-seated first on a tie), and the
game deals. There is no ready button.

A team that would become more than one bigger than the smallest team is closed
to joiners, and says so ("Blue is full for now").

### A game

A game is `rounds × turns`.

- **Everyone for themselves:** in a round, every seated player draws once, in
  seat order.
- **Teams:** in a round, every team draws once, in team order. A team's members
  are ordered by when they joined it; the team's k-th turn (counting from 0
  across the whole game) is drawn by members `k mod n` and `(k + 1) mod n`. A
  team of 3 draws (A,B), (B,C), (C,A); a team of 2 is always both. A team of
  one — somebody else left — draws alone.

The picker is the first-listed drawer, member `k mod n`. Because the pairs
rotate, every member of a team is first-listed once every `n` of its turns, so
picks are shared evenly without any separate alternation; a team of 2 swaps
picker every turn. In Everyone for themselves the drawer picks.

### A turn

Three phases, each one adapter `pause()` with its own key, so a timer belonging
to a phase that has ended can never fire into the next.

1. **Pick — 15 s.** The picker sees three words; the partner sees the same
   three and who is choosing. A pick lands on the press. If time runs out, the
   server picks one of the three at random.
2. **Draw — the host's draw time.** Hint letters are revealed at fixed points
   of the clock (see Hints). The turn ends early when every eligible guesser
   has guessed, or when no drawer is left at the table.
3. **Reveal — 5 s.** The word, what each person scored, and — in Teams — each
   team's total ticking up.

After the last turn of the last round the reveal becomes the game's result
(winner, or winning team), shown for 10 s, and the table goes back to Waiting
with its teams kept.

### Hints

Letters are revealed at fixed fractions of the draw time, never spaces or
punctuation, which show from the start.

| Setting | Revealed |
|---|---|
| None | nothing |
| A few | ⌊letters ÷ 4⌋ letters, spread across 50 %–80 % of the clock |
| Generous | ⌊letters ÷ 2⌋ letters, spread across 30 %–85 % of the clock |

Which letters are revealed is chosen by the server when the word is picked, so a
reconnecting client sees the same ones.

### Guessing

A guess is compared after normalising both sides: lower case, accents removed,
runs of whitespace and hyphens collapsed to one space, apostrophes dropped.

- **Correct** — the guesser scores, the room is told "Priya got it", and the
  word is never shown to anybody who has not guessed.
- **Close** — for words of 5+ letters, a guess one edit away (Levenshtein
  distance 1). Shown to its author only: "lighthose: you're close".
- **Anything else** — an ordinary line in the log.

Drawers cannot guess. People who have already guessed cannot guess again.

### Scoring

- A guesser scores `50 + round(250 × timeLeft ÷ drawTime)`.
- Each drawer scores `round(250 × correctGuessers ÷ eligibleGuessers)`.
- A turn with no eligible guessers scores nothing.
- In Teams, a team's score is the sum of its players' scores — including
  players who have since left, whose points stay with the team.
- The winner is the highest score (or team). A tie is shared.

### Joining and leaving

- **Joining mid-game:** you can guess at once, and you enter the drawing order
  from the next round. In Teams you are put on the smallest team.
- **A drawer leaves mid-turn:** their partner carries on alone. If nobody is
  left drawing, the turn goes straight to Reveal and nobody scores.
- **The table drops below its minimum:** the current turn finishes, a notice
  says why, and the table goes back to Waiting. A team left empty is dropped
  until the next game.
- **The last player leaves:** the table closes, as every table does.

`leavesMidHand` is true: nothing is staked, so a leave can always be honoured
at once.

## Host options

Set in `TableSetup` when the table is opened, and fixed for the life of the
table.

| Option | Choices | Default |
|---|---|---|
| Mode | Everyone for themselves / Teams | Everyone for themselves |
| Teams | 2 / 3 / 4 (Teams only) | 2 |
| Seats | 4 / 6 / 8 / 10 | 8 |
| Rounds | 2 / 3 / 4 / 5 | 3 |
| Draw time | 60 / 80 / 120 s | 80 s |
| Hints | None / A few / Generous | A few |
| Packs | any of the eight, at least one | Everyday, Animals, Food & drink |
| Your own words | up to 200; "only my words" once 10 or more are valid | none |

`createSchema` in `packages/shared/src/schemas.ts` names every field it accepts
and strips the rest, so the options travel as one new, bounded, optional
`scribble` object on it. The game still validates and snaps every value to a
real choice, the same way blackjack snaps a stake. Seats fewer than `2 × teams`
are refused at setup with a message that says so.

In the setup screen: Mode is a pair of `.plate`s, Teams / Seats / Rounds / Draw
time are `.lamps`, Hints is a `Seg`, Packs are `.lamp--word` toggles, custom
words are an `.entry` with a textarea.

## Words

`games/scribble/src/words/` — one TypeScript module per pack: **Everyday,
Animals, Food & drink, Films & TV, Places, Sport, Music, Hard mode**, each a
plain `readonly string[]` of roughly 150–300 words.

Every word, built-in or custom, must be:

- letters, spaces, hyphens and apostrophes only;
- 3–24 characters, at most 3 words;
- unique within its pack (compared normalised).

A test enforces this over every built-in pack. Custom words are held to the
same rules; ones that fail are dropped and counted in the hint ("2 skipped").
Custom words live on the table only and are never saved.

Each turn's three choices are drawn from the enabled packs plus custom words (or
custom words only), skipping any word already played in this game. The word
lists are the one piece of content work here and need a human read before
launch.

## Architecture

### `games/scribble`

Named `@backroom/game-scribble`, exporting `.` and `./theme.css`, like the
others.

| File | What it is |
|---|---|
| `listing.ts` | `SCRIBBLE` — the catalogue entry. |
| `options.ts` | Snapping host options to real choices. |
| `rotation.ts` | Who draws next, and which pair. Pure. |
| `scoring.ts` | A turn's points. Pure. |
| `hints.ts` | Which letters, and when. Pure. |
| `guess.ts` | Normalising, correct and close. Pure. |
| `words/*.ts` | The packs, and drawing three words. |
| `ink.ts` | The stroke log: append, undo, clear, the cap. Pure. |
| `table.ts` | `ScribbleTable implements PlayTable` — the state machine, given its clock and random source so tests control both. |
| `adapter.ts` | `scribbleAdapter()` — `act`, `pause`, `chat`, `winners`. |
| `theme.css` | The room. |

The random source used for word choice and hint letters is injected; nothing is
at stake, so `Math.random` is acceptable in production, but tests must be able
to fix it.

`settle` does nothing, `void` returns `[]`, `isSettled` is true while a game's
result is showing. `winners` reports the winning seats, because taunts pay out
on friendly wins too. `deps.finished` is not called — a friendly is not written
into the history.

### Actions

Validated by zod inside the game.

| Action | From | Payload |
|---|---|---|
| `pickTeam` | anyone, while Waiting | `{ team: 0–3 }` |
| `pick` | the picker, during Pick | `{ index: 0–2 }` |
| `stroke` | a drawer, during Draw | `{ id, seq, ink, size, pts }` |
| `fill` | a drawer, during Draw | `{ x, y, ink }` |
| `undo` | a drawer, during Draw | `{}` |
| `clear` | a drawer, during Draw | `{}` |

- **Coordinates** are integers on a fixed **1000 × 750** grid, so a point means
  the same place on every screen. `pts` is a flat `[x0, y0, x1, y1, …]` of at
  most **64 points**.
- **`id`** is a stroke id the drawer's client makes; later batches with the same
  `id` extend that stroke. **`seq`** numbers the batches so a repeat is
  discarded.
- **`ink`** is one of nine named inks; **`size`** one of three. Nothing
  free-form.
- **`undo`** removes the most recent stroke or fill *by that drawer*, never the
  partner's.
- **`clear`** empties the napkin for both drawers.
- **The cap:** a turn holds at most **20,000 points**; a stroke past it is
  refused with "The napkin's full". `clear` resets the count.

A drawer sends one batch per animation frame, at most every 50 ms — at most 20
a second against `guard()`'s 30, leaving room for tool changes, undo and clear.

### Change to core: an action that relays instead of broadcasting

`GameAdapter.act` may return `{ relay: unknown }`:

```ts
act(table: T, seatId: string, action: unknown, deps: GameDeps):
  | Promise<void | ActResult>
  | void
  | ActResult;

interface ActResult {
  /** Sent to everybody else in the room in place of a full broadcast. */
  relay: unknown;
}
```

When an action returns a relay, `guard()` emits `room:relay` (`{ seatId,
payload }`) to every other socket in the room — watchers included, the sender
excluded — and does **not** call `broadcast()`. Everything else about `guard()`
is unchanged: rate limit, seat check, refusal.

A relay may only carry something that `view()` would also show, so a client
that reconnects or joins late loses nothing: `view()` includes the current
turn's whole stroke log. A relay never changes the phase, so no clock, pause or
settlement needs re-arming. Every existing game returns nothing and is
unaffected.

### Change to core: a game may route chat

Today `chat:send` goes to the whole room. At a Scribble table that is a way to
tell everybody the word, so a game may take over where a line goes:

```ts
chat?(table: T, seatId: string, text: string): ChatRoute;

type ChatRoute =
  | { to: "room" | readonly string[]; kind?: string; text: string; changed: boolean }
  | null;
```

`null` drops the line (a refusal is thrown as `TableError`, as from `act`). The
server sends the line only to sockets seated at the listed seats (or the whole
room), with the optional `kind`; if `changed` is true it broadcasts state
afterwards. `ChatMessage` in `packages/shared` gains an optional `kind`. A game
without `chat` keeps today's behaviour exactly. The chat rate limit — 5 lines
per 5 s — is unchanged; that is enough to guess with, and a ceiling on guess
spam is a feature.

Scribble routes as follows:

| Who types | Phase | Goes to | `kind` |
|---|---|---|---|
| A guesser, wrong | Draw | everybody except those who have guessed | `guess` |
| A guesser, close | Draw | the guesser only | `close` |
| A guesser, correct | Draw | everybody, as "Priya got it" | `got` (`changed: true`) |
| A drawer, with a partner | Draw | the drawers only; refused if it contains the word | `pair` |
| A drawer, alone | Draw | refused: "You're drawing" | — |
| Somebody who has guessed | Draw | everybody who has guessed, and the drawers | `aside` |
| Anyone | Pick, Reveal, Waiting | everybody | — |

"Contains the word" is checked on normalised text with spaces removed, so
"light house" and "LIGHT-HOUSE" are refused too.

### Registration

- `apps/server/package.json` — the dependency.
- `apps/server/src/server.ts` — `.add(SCRIBBLE)` to the catalogue, an entry in
  `ADAPTERS`, and the two changes above in `guard()` and the `chat:send`
  handler.
- `packages/shared` — `room:relay` in `ServerToClient`, `kind` on
  `ChatMessage`, the `scribble` options object on `createSchema`.
- `packages/core/src/game.ts` — `ActResult`, `ChatRoute`, `chat?`.
- `apps/web` — `package.json`, `vite.config.ts`'s package list, routes
  `/scribble` and `/scribble/:code` in `App.tsx`, a `TileArt` branch, the theme
  import in `Room.tsx`.

### `apps/web/src/scribble`

| File | What it is |
|---|---|
| `Scribble.tsx` | The page, on `useTableSocket<ScribbleView>("scribble", …)`. |
| `Napkin.tsx` | The canvas. |
| `useInk.ts` | Local drawing, batching, pending strokes, applying relays. |
| `fill.ts` | Flood fill on the fixed bitmap. |
| `Tray.tsx` | Inks, sizes, fill, eraser, undo, clear. |
| `GuessLog.tsx` | The log and its input, rendering each `kind`. |
| `Teams.tsx` | Team wells on desktop, pills and a roster sheet on a phone. |
| `WordPick.tsx`, `Reveal.tsx`, `TeamPick.tsx` | The three in-between screens. |
| `scribble.css` | The felt parts; imported, and checked to be. |

**The napkin** is two canvases. Finished strokes are drawn onto an offscreen
**1000 × 750** bitmap, which is scaled onto the visible canvas; strokes still
arriving are drawn on a live layer above it, smoothed with quadratic curves.
**Fill runs on the fixed bitmap**, never on the screen-sized one, so a fill
floods exactly the same pixels on every device — a fill on a phone and on a
desktop must agree, or the two drawers are looking at different pictures.

## The building's rules

### Chips

None move. `forFun` is forced, there is no buy-in, the table has no purse, and
nothing touches an account. The rules about chips apply by not applying.

### The server is the only authority

The word, who may draw, whether a guess is right, the score, the clock and who
sees which chat line are all decided on the server. The client hides the tray
from guessers and the input from drawers as a courtesy; the server refuses the
action either way.

### A press lands immediately

- **Your own ink is yours:** a stroke appears under your finger at once, before
  any acknowledgement, and is dropped if refused (the turn ended) when the next
  state arrives.
- **A typed guess** appears in your log at once, marked pending. Whether it was
  right is only the server's to say, so the green "got it" waits for it.
- **A word pick** lights its plate on the press.
- **Team pick** moves you on the press, and moves you back if refused.
- **The word itself** is never guessed at: blanks until the server sends
  letters.

### Animated, and the animation says what happened

- A pen dot leads each live stroke in; it goes when the stroke ends.
- Hint letters flip into their blank with one small overshoot.
- The clock is a fuse along the strip that drains; it does not pulse.
- "Got it" slides into the log, and that person's row flashes green once.
- The reveal types the word onto the `.lcd` a letter at a time, then the team
  totals tick.
- Clear wipes the napkin in one sweep.

Every keyframe in `scribble.css` has an off switch under
`prefers-reduced-motion`, and the page still says everything without them — a
test enforces it the way `fittings.css.test.ts` does.

### Sound

Under the player's own volume and mute.

- **Sampled, for physical things:** a quiet marker squeak under your own
  strokes and your partner's (at most once per stroke for a relayed one, so a
  guesser's speaker is not a running squeak), a paper swipe on clear.
- **Synthesised, for the interface:** a tick in the last 10 s, a chime for your
  own correct guess, a softer one for anybody else's, a short sting on reveal.

Raw samples go in `assets/audio/raw` like the rest.

### Phones

Checked at 375 px before anything is called done.

- The napkin takes the full width.
- Team scores become four pills; tapping one opens the rosters. Nothing is
  reached by hover — the partner's pen label is always shown.
- The guess input (guessing) or the tray (drawing) is pinned within thumb reach.
- The tray fits without sideways scrolling: nine inks share one row, and Clear
  is an icon key.
- The napkin sets `touch-action: none` and uses pointer events, so drawing never
  scrolls the page; its backing canvas is sized for the screen's pixel density,
  capped at 2×.
- `.lamp` shares its row equally, which breaks word labels mid-word; the
  library gains a modifier for word lamps that size to their label and wrap
  whole, used by the packs.

### A table that deals itself

It does: Waiting counts down and deals once enough people are seated, every
phase runs on its own `pause()`, and no single idle player can hold anything
up — an unpicked word is picked for them, an unpicked team is assigned.

## Testing

Every rule above that can be broken gets a test that fails without it.

**Pure logic**

- `rotation`: pairs for teams of 1–5 across rounds; everyone draws; picker
  alternation.
- `scoring`: the formulas; no eligible guessers; points kept by leavers.
- `hints`: counts per setting; spaces never hidden; the same letters for the
  same seed.
- `guess`: normalisation; close only for 5+ letters and distance 1; the
  contains-the-word check on "light house".
- `ink`: batches append by `id`; `seq` repeats discarded; undo removes only the
  undoer's stroke; the 20,000-point cap and clear resetting it.
- `words`: every built-in word passes the rules; no duplicates.
- `options`: snapping; seats fewer than `2 × teams` refused.

**The table, on a fake clock**

- Waiting deals after 15 s once the minimum is seated, and not before.
- Unpicked players land on the smallest team; a team more than one bigger is
  closed.
- Pick times out to one of the three words.
- Draw ends early when everybody has guessed, and when every drawer leaves.
- A drawer leaving mid-turn leaves the partner drawing.
- Dropping below the minimum finishes the turn and returns to Waiting.
- A stale pause key does nothing.

**The server**

- A relaying action reaches every other socket in the room and not its sender,
  and triggers no `room:state`.
- `chat` routing: for each row of the routing table, a socket not in `to` never
  receives the line; a pair message containing the word is refused; a game
  without `chat` still broadcasts to the room.
- Stroke and guess actions from somebody not allowed them are refused.

**The client**

- On a delayed socket (a clock, not by eye): your own ink is on the canvas
  before any acknowledgement; a refused stroke is removed when state arrives;
  a pending guess shows at once and is replaced by the server's line.
- Fill on the fixed bitmap produces identical pixels at two canvas display
  sizes.
- `scribble.css` is imported; every animation is off under reduced motion.
- By hand, recorded in the commit: every screen at 375 px and desktop, on a
  throttled connection, drawing with a partner on a second device.

## Amendments from planning

Found while writing the implementation plan against the code. Where these and
the sections above disagree, these win.

1. **Everyone for themselves needs 3, not 2.** `packages/core/src/coming.ts`
   already listed Scribble with `minSeats: 3` and the reason: two is one person
   drawing for an audience of one, with no race between guessers. Teams still
   need `2 × teams`.
2. **The listing moves out of `COMING`** into `games/scribble/src/listing.ts`,
   repainted in the approved room: wall `#131218`, felt (the napkin) `#f2efe9`,
   accent `#e2409c`, accent-hi `#ff9ad3`. The old terracotta is dropped.
3. **Actions are narrowed by hand, not by zod.** zod lives only in
   `packages/shared`; every game narrows its own actions, and Scribble follows.
4. **The table is given `now: () => number`** as well as its random source, so
   tests drive a clock rather than fake timers.
5. **A guess that contains the word without being it** ("the lighthouse") goes
   to its author only, as `close`. Sent to the room it would tell everybody.
6. **Drawers' chat goes to the drawers during Pick as well as Draw,** and is
   refused if it contains any of the three choices — the choices are as secret
   as the word.
7. **The napkin is rasterised by the game's own code, not the canvas's.** A
   browser antialiases a line differently from another browser, so a flood fill
   bounded by canvas-drawn lines floods different pixels on different devices.
   Strokes are stamped as discs onto a 1000 × 750 pixel buffer by
   `apps/web/src/scribble/raster.ts` and put onto a canvas of exactly that size,
   scaled by CSS. The "backing canvas sized for pixel density" line above is
   replaced by this.
8. **The eraser is an ink** — `paper`, the napkin's own colour — so erasing is a
   stroke like any other and undoes like one.
9. **Sound is synthesised throughout for now.** There are no marker or paper
   recordings in `assets/audio/raw`, and `pickNamed` silently plays any file in
   a group when none matches. Recording them is a follow-up.
10. **Each pack ships with 40 words,** enforced by a test. Growing them towards
    150–300 is content work after the build.
11. **Seats use the building's own `SeatCount`** inside `TableSetup` (up to
    10, starting at 8), not a Scribble-only 4 / 6 / 8 / 10 row. A table too
    small for its mode is refused by the adapter, and the setup note says so
    before the host presses.
12. **No separate pen dot leads a stroke in.** The napkin already shows your
    line under your finger and a partner's line as each batch lands, which is
    the arrival; a dot on top would be a second motion on the same thing.

## Out of scope

- Bots, chips, and any history record.
- Saving custom word lists between tables.
- Languages other than English.
- Voting to kick, reporting drawings, or moderating the canvas.
- Spectator-only drawing replays and saving drawings.
- Seats above 10, and running the server across more than one process.
