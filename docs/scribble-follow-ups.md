# Scribble — known issues and follow-ups

Scribble shipped after 21 planned tasks, 11 fix rounds and a three-part
whole-branch review. Everything below was found by that review process and
deliberately **not** fixed before merge, so the game could reach the floor.
Nothing here stops a player playing; the one defect that would have — the
game naming departed players as winners, which moved chips through the taunt
pool — was fixed before merging.

Each entry says where it is, why it matters, and what fixing it looks like.

## Important

### 1. `InkBook.inflight` has no reconciliation point

`apps/web/src/scribble/inkBook.ts` — `sync()` corrects `server`, `pending`,
`stampOf` and `stampCounter` from the server's truth, but never `inflight`,
which is the queue refusal attribution depends on. `acked()` is its only
drain, and `clear()` resets every other field but not this one.

In practice the server always acks, so it drains. But one lost ack — a
disconnect or reconnect mid-turn — skews the queue for the rest of the turn,
and every later refusal is blamed on an action that is already dead.

**Fix:** empty `inflight` wherever `pending` is emptied — the `!drawing`
branch of `sync()`, and `clear()`.

### 2. `Napkin.test.tsx`'s dedup test cannot fail

The test "collapses several notifies before a frame runs into a single paint"
asserts only `painted.length`. Without the `pending` flag it exists to guard,
`frames` becomes 4 — but draws 2–4 call `update()` with unchanged marks, which
returns `false` via `onlyGrows`, so nothing paints and `painted.length` is 1
either way. The assertion cannot distinguish the two worlds.

This breaks CLAUDE.md's explicit rule: a bug fix needs a test watched failing
against the old code.

**Fix:** `expect(frames).toHaveLength(1)` before `runFrames()`.

### 3. Touch targets under the 44px floor

- **Undo and Clear** are 40×40 (`.key--icon` in `fittings.css`). Three other
  uses of that class are occasional chrome; Scribble's are in-turn controls
  under a countdown on a phone. `scribble.css` invokes the 44px thumb floor two
  rules earlier to justify rewriting the ink row, then leaves these at 40 — an
  inconsistency inside its own reasoning.
- **`.sc-pill`** is `min-height: 40px` and **phone-only** (`.sc-pills` is
  `display: none` above 900px), so unlike Undo/Clear it has no building-wide
  defence at all: a sub-44px tap target in Scribble's own stylesheet, reachable
  only by thumb.

**Fix:** a local `.sc-tray .key--icon { width: 44px; min-height: 44px }` and
raise `.sc-pill`. Neither touches another room.

### 4. `GuessLog`'s `error` prop is table-wide

`apps/web/src/scribble/GuessLog.tsx` — an *ink* refusal retracts a guess that
is about to be echoed. And because `useTableSocket` auto-clears `error` after
4s, two identical refusals inside that window leave `error`'s identity
unchanged, the effect never re-fires, and the second refused guess sits on
screen for the full 8s of `PENDING_MS`.

`WordPick` and `TeamPick` already solved exactly this with a per-press token,
and their comments name the identical failure. `GuessLog` is the one of the
three that did not.

### 5. Watchers never see wrong guesses

`games/scribble/src/table.ts` routes a wrong guess to a seat-id list, and the
server's delivery loop only emits to sockets with a non-null `seatId`, so
watchers are excluded by construction.

This was reviewed and **decided as wrong**: a watcher already sees the drawing
live, which is strictly more information than any guess conveys, so hiding
guesses protects nothing. Worse, the current split is the least defensible
option available — watchers *do* receive "got it" (routed to `"room"`), so they
learn the word was solved and by whom, while being denied the near-misses that
make watching worth doing.

**Fix:** `ChatRoute` in `packages/core` cannot currently express "the room,
minus the seats that have already guessed". Add an optional
`watchers?: boolean` that the delivery loop honours for a seat list, and set it
on the wrong-guess route. Seat-only routing must stay for `pair`, `close` and
`aside` — those are genuinely private.

### 6. Two timing flakes in the socket tests

`apps/server/src/scribble.socket.test.ts`. CLAUDE.md: flakes are bugs.

- **The 4-player solo tables can deal with only three seated.**
  `minimumPlayers` is 3 for solo, `settleCountdown` arms the deadline at the
  third join and deliberately does not re-arm, and the harness uses
  `countdownMs: 30`. The assertions survive it, but the premise is
  timing-dependent. Fix by raising `countdownMs` for those tests, or seating
  all four before the countdown can arm.
- **The fixed 150ms `heard()` window** is fine for proving absence, but the
  positive assertions fail if a line lands at 160ms under load. Await the event
  for those; keep the timer only for negative assertions.

### 7. Untested seam behaviour

No test covers a **watcher receiving a relay**, or the **reconnected-seat chat
walk** — and the socket-walk in the server names reconnection as its whole
reason for existing.

### 8. The room has no render tests, and cannot have them today

Eight consecutive rounds on `scribble.css` each introduced the next round's
finding — a width-only napkin, a cap that reopened a gutter, a `justify-self`
that shrank every panel, a word-centring that un-pinned the clock in four of
five phases, a chrome constant left at a stale fallback. **None was caught by
the suite; every one was caught by a human reading CSS.**

It cannot be caught as things stand: there is no layout engine in the
toolchain. jsdom has none, `getComputedStyle` appears in zero tests repo-wide,
every `offsetWidth` is 0.

**Recommended split:**

- **Cross-file consistency stays in Node**, and should *parse* rather than
  regex. `lightningcss` is already imported in `stylesheets.test.ts`, so asking
  "what declarations does `.sc-napkin` actually resolve to" costs no new
  dependency and kills the whole "the regex could not see it" class.
- **Geometry needs a browser** — six assertions in one file, at 375px and
  1280px:
  1. nothing scrolls sideways, across all five phases, as drawer and as guesser
  2. the napkin fits its budget, with the tray (drawer) and without (guesser)
  3. the clock is flush right in all five phases
  4. the gutters either side of the napkin are equal
  5. side panels fill their area before clamping
  6. every tray control is ≥44×44 — this would **currently fail** on Undo and
     Clear, which makes issue 3 self-enforcing rather than perennially deferred

## Minor

- `scribble.css.test.ts`'s `animated()` is a weakened copy of
  `fittings.css.test.ts`'s `moving()` one directory away: it misses
  `transition:`, `animation-name:` and duration-first shorthand. No live bug —
  `scribble.css` has zero transitions today — but the guard will not catch the
  first one added.
- Three class hooks have no rule in any stylesheet: `sc-over__note`, `sc-row`,
  `sc-teampick`. The orphan-CSS hazard in reverse.
- The fuse's `key` sits on `.sc-strip`, so a phase change remounts `Word` and
  the clock as well as replaying the fuse. Harmless while both stay stateless,
  though it may cause re-announcement of a `role="timer"` and a `role="img"`.
  `Napkin.tsx` already models the narrower pattern with `key={wipe}`.
- `fuseAt`'s `totalMs <= 0` branch is unreachable in practice and wants a
  comment saying it is defensive.
- `raster.ts` silently draws medium for an out-of-range size (`?? SIZES[1]`) —
  defence in depth only, since the server validates.
- No continuity test at radius 1 or 2 for a diagonal segment.
- `raster.test.ts` shadows the module's `at` helper.
- `GuessLog`'s React key collides on a repeated guess inside one millisecond
  (house-consistent with `game/Chat.tsx`); `id="scribble-guess"` labels nothing;
  `scrollTo?.()` is optional-called for jsdom's sake.
- `marks()` hands out live references into `server`, which `applyRelay` mutates
  in place. Safe today because `Raster` reads synchronously; `version` is the
  documented guard.
- `toGrid` clamps inclusively to `GRID_WIDTH`/`GRID_HEIGHT`, one past the last
  valid index. Nothing reads out of bounds, but that rests on clipping that
  happens to be there rather than on a stated invariant. The server's validator
  accepts the same range, so it is consistent end to end.
- A near-maximum word (24 chars, the `wordProblem` cap) wraps `.sc-word` in the
  900–1000px band, costing one extra strip line (~24px) that the chrome
  reservation does not account for. Slight vertical scroll; never sideways.
- `SEAT_CHOICES` is exported from `games/scribble` and imported by nothing.
  Delete it.
- `act`'s return type (`Promise<undefined | ActResult> | undefined | ActResult`)
  diverges from `payOut?`'s biome-ignored `void` in the same interface. A future
  adapter annotated `Promise<void>` will not compile, for a reason the interface
  does not explain. Align it or say why it differs.
- `guard()`'s `run: (…) => unknown` switches off return-type checking at its
  five other call sites. All safe today; a future concise arrow returning a
  relay-shaped object would silently skip `broadcast()`.
- `guard()` has two stacked doc comments; the first is a leftover one-liner.
- The design spec's Actions table says "nine named inks" — `INKS` has ten, the
  tenth being `paper`, the eraser, which the wire accepts. Amendment 8
  reconciles it, so the document is self-consistent, but a reader checking the
  wire is off by one.
- `smallestTeam([])` returns 0 where `teamTurn` throws for an empty team. Both
  call sites are guarded, so it is unreachable — a consistency wart.
- A correct guess landing after the deadline but before the tick scores the
  50-point floor rather than being refused. This is the forgiving choice and is
  deliberate; it wants a comment saying so, or the next reviewer re-files it.
- The rotation index counts against a member list that shrinks on leave, so
  after a departure the same member can pick twice running, and a team emptied
  mid-game is skipped for the rest of that game while still showing a score.
- `backToWaiting` leaves turn residue set; unreachable because every caller
  passes through `nextTurn` first, but that is luck of call order rather than
  construction. One comment would stop it being re-introduced.
- `buildRound` filters `!seat.isBot`, defending a case the server makes
  impossible for this table.
- `everyday` is otherwise firmly British but ships `zipper` and `mailbox`.

## Pre-existing and building-wide — not Scribble's to fix alone

- **`audio.test.ts` has no mute or volume coverage at all.** The gates are real
  (`play` bails on no context, muted, or zero volume; `tone` and `noise` bail
  again), and Scribble's six new cues pass through that same single gate, so
  they add no new risk. Wants its own task.
- **`lightningcss` is imported in `stylesheets.test.ts` but declared in no
  `package.json`** — it resolves only as a transitive dependency of Vite, so a
  Vite bump could silently break that suite.
- **`packages/shared` declares `MAX_SEATS = 8` while `packages/core` says 10.**
  Pre-existing, but Scribble is the first game to actually want 10 seats.
- **`/peek` reports a Scribble table as `forFun: false`** — the server computes
  it by duck-typing a property `ScribbleTable` does not have. The opposite of
  the truth, for a game that is for-fun by construction. Harmless to the
  economy, misleading in the response body.
- **`lobby:join` does not check whether a socket is already seated** before
  seating it. Affects every game; it is the only route by which a same-id
  rejoin becomes reachable.
- **Relay and `room:error` fan-outs iterate listener sets without `try`/`catch`**
  — one throwing listener silently drops the rest. Consistent with the file's
  other handlers.
- **The chat log is capped at 60 lines.** Judged honest: scores live
  server-side and a correct guess is a state change, so what a guess *means*
  survives eviction even when the line does not. At a 5-per-5s limit across ten
  seats that is roughly twelve seconds of maximum-rate chat; raising it to 200
  is a reasonable follow-up.

## A note on the commit history

Three commits on this branch (`30ee0d8`, `df4f7dc`, `b25115a`) carry a
`Co-Authored-By: Claude Haiku 4.5` trailer naming the wrong model. They were
left unrewritten deliberately: correcting them means rewriting history, which
would change every SHA from that point forward, and the development ledger and
twenty task reports cite those SHAs throughout as the audit trail of this work.
A correct audit trail was judged worth more than three correct footers.
