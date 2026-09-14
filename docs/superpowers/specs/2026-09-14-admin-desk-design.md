# The admin desk, rebuilt

## Why

The admin page is one long pile of panels: four bank cards that each repeat the
same paragraph, a code form, an emote form and two tables, in whatever order
they happened to be added. It is hard to find anything on it, and it cannot do
several things an admin now needs:

- give chips to, or take them from, one player, a group, or everybody;
- set a player's balance outright;
- reset players — all of them or some — without deleting them or signing them
  out, choosing what gets wiped;
- see a record of all of the above;
- delete an emote for good rather than only retire it.

## Out of scope — and what it forces

No game can call off a hand and give back what is in play; a table that closes
today loses its felt, pot, bank stakes and taunt pools. Building that is its
own project (per-game void and refund, plus a `room:closed` event). Until it
lands, **a reset is refused while anybody it would touch is seated at a
table**. When voiding exists, reset gains "close their tables first" on top of
it. Slots is unaffected: a spin holds nothing between presses.

## House rule

CLAUDE.md's money section says chips come from the daily and from redemption
codes an admin mints. A grant is the same authority as minting a code, so the
sentence is amended to: chips come from the daily, and from an admin — by a
redemption code or by a logged grant. Nothing about this creates a route from
money to chips.

## Server and economy

All new routes sit behind `requireAdmin` and answer 404 to anybody else, as the
existing admin routes do. The client may show every limit below; the server is
the thing that enforces them.

### Store additions

Added to the `Store` interface and implemented in both `MemoryStore` and
`MongoStore`.

- `listUsers({ query, offset, limit })` → `{ rows, total }`. A row is
  `{ id, name, avatar, accentColor, chips, games, createdAt }`. `query` is a
  case-insensitive name prefix; empty lists everybody, richest first. `limit`
  is capped at 100.
- `adjustBalances({ target, op, amount })` → `{ affected, moved }`.
  - `target` is `{ all: true }` or `{ ids: string[] }` (at most 500 ids).
  - `op` is `add`, `remove` or `set`; `amount` is a whole number, ≥ 1 for add
    and remove, ≥ 0 for set, and at most 10,000,000.
  - `remove` never takes a balance below zero; `moved` is the chips actually
    added or taken (negative for a net removal), so the log says what happened
    rather than what was asked for.
- `resetUsers({ target, parts })` → `{ affected }`. `parts` is a non-empty set
  of:
  - `balance` — chips back to `STARTING_CHIPS`;
  - `stats` — `stats` and `byGame` cleared;
  - `jar` — the tip jar record cleared;
  - `history` — the player's transfers (either side), code redemptions, and
    their entry in stored game records removed. Other players in those games
    keep their own entries; a game record left with no signed-in player in it
    (bots and guests do not count) is deleted.
    Removing redemptions is what makes a used code redeemable again, and the
    code's redemption count drops with it.
  The user document itself, its id, Discord id, name and avatar are kept, so
  sessions keep resolving and nobody is signed out.
- `bankEmpty(which)` → the amount that was in it.
- `deleteEmote(id)` → `boolean`. Removes the row and its image and sound bytes.
- `logAdmin(entry)` and `adminLog({ limit, before })`. An entry is
  `{ id, at, by, byName, kind, amount, affected, target, note }`, where `kind`
  is `add | remove | set | reset | float | empty-banks | delete-emote`, `target`
  is `"all"` or the list of ids, and reset entries carry the parts that were
  wiped. Mongo keeps these in an `adminlog` collection.

### Routes

| Route | Body / query | Answer |
|---|---|---|
| `GET /api/admin/users` | `q`, `offset` | `{ rows, total }` |
| `POST /api/admin/chips` | `{ op, amount, target, note }` | `{ affected, moved }`, 400 on a bad body |
| `POST /api/admin/reset` | `{ target, parts, emptyBanks? }` | `{ affected, emptied? }`; 409 `{ error, seatedAt }` while any targeted player is seated, where `seatedAt` is the number of tables blocking it |
| `GET /api/admin/log` | `before` | `{ entries }`, newest first, 50 a page |
| `POST /api/admin/emotes/:id/delete` | — | `{ ok: true }`, 404 if no such emote |

- `emptyBanks` is only accepted with `{ all: true }`.
- The building parses JSON at 8KB, and 500 ids is about 13.5KB, so the chips
  and reset routes carry their own 64KB parser and are excluded from the small
  one — the same arrangement the emote upload already has.
- A note is optional, trimmed, at most 120 characters.
- Bank floats (`POST /api/admin/bank`) and emote deletions are logged too.
- "Seated" means a non-bot seat with that user id at any live room, connected
  or not. For `{ all: true }`, any room with a real person seated blocks it.

### Live balances

After a grant, removal, set or reset, every affected player who has a socket
connected is sent `me:chips` with their new balance — through the same
walk over `io.sockets` the server already uses to push a balance — so the pill in their
navbar moves without a reload. Anybody not connected sees it on their next
`/api/me`.

### Deleting an emote

The row goes, the server's `emotesSeen` cache forgets it, and its image and
sound routes answer 404. A live taunt pool still holding it keeps its chips;
when it replays, the client shows the emote's name with no picture or sound.
Retire stays as the soft option.

## The page

`/admin` becomes tabs: **Banks · Players · Codes · Emotes · Log**. The tab lives
in the URL (`/admin?tab=players`), so a reload stays put and a tab can be
linked. Access is decided as now: a 404 from the server shows "No such page."

`Admin.tsx` is split into `admin/Banks.tsx`, `Players.tsx`, `Codes.tsx`,
`Emotes.tsx` and `Log.tsx`, with the shell and tab bar in `Admin.tsx`. Styles go
in a new `admin/admin.css`, imported from `Admin.tsx`, and checked to be loaded
before any rule is added to it.

### Banks

The four banks as matching cards in a grid (one column on a phone): balance,
the stake it covers in that game's own words, and an amount box with a float
button on one line. The paragraph about banks being filled by players appears
once, above the grid. `BANKS` and its test stay.

### Players

- A search box, then the list: checkbox, face, name, chips, games, joined.
  Paged 50 at a time.
- Selecting anybody raises an action bar pinned to the bottom of the screen —
  within thumb reach — showing how many are selected and **Add · Remove ·
  Set · Reset…**.
- The header carries the everybody actions: **Give everyone… · Reset
  everyone…**.
- Add, Remove and Set open a small dialog: amount, note, and a sentence saying
  exactly what will happen ("Take up to 5,000 from 3 players").
- Reset opens a dialog of part checkboxes, Balance ticked by default. Resetting
  everybody adds the "also empty the banks" checkbox, off by default, and a
  box that must read `RESET` before the button enables.
- A 409 is shown in the dialog in words: how many tables are holding people.
- On a phone the list becomes one card per player; nothing scrolls sideways.

### Codes

The mint form as one row (chips, uses, note, button) that wraps on a phone,
then the code list as it is now.

### Emotes

The upload form, compacted to two columns on a desk. Emotes as a grid of cards
— picture, name, cost, sound, size — each with **Retire** and **Delete**.
Delete asks once, inline ("Delete for good?") and disarms after a moment, the
same pattern as leaving a table. Retired emotes are dimmed and keep Delete.

### Log

Newest first: when, which admin, what (in words — "Gave 5,000 to everyone",
"Reset balance and stats for 2 players"), and the note. A "Load older" button
pages back.

### Feel

Tab changes and dialogs use one short fade-and-rise; both have a
`prefers-reduced-motion` off switch. A press shows its result straight away
where the admin chose the number, and the list is refreshed from the server's
answer. Everything is checked at 375px.

## Tests

Server, against `MemoryStore` through the HTTP routes:

- every new route answers 404 to a non-admin and to a guest;
- add, remove and set move the right chips for ids and for everybody; remove
  stops at zero and reports what it actually took;
- each reset part clears only its own data and leaves the user signed in;
- a history reset makes a code the player already used redeemable again, and
  leaves another player's record of a shared game intact;
- reset is refused with 409 while a targeted player is seated, and for
  everybody while anybody is;
- `emptyBanks` empties every bank and is refused for a list of ids;
- a deleted emote's image answers 404 and it is gone from the list;
- each action writes the log entry it should, including floats.

Economy: `MongoStore` gets the same store-level cases in
`packages/economy/src/mongo-store.test.ts`, under whatever database that file
already runs against.

Web:

- the tab in the URL picks the tab, and switching changes the URL;
- selecting players raises the action bar with the right count;
- "Reset everyone" stays disabled until `RESET` is typed;
- Delete on an emote asks before it sends.
