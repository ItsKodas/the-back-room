# Raw audio drop zone

Drop source sound files here as you find them. Nothing here ships directly —
a build step normalizes, converts and packs these into an audio sprite. So
don't worry about format consistency, loudness matching, or trimming.

## Rules of thumb

- **Prefer CC0.** If you grab anything CC-BY (or anything with any obligation),
  add a line to `CREDITS.md` next to it with the source URL and licence.
- WAV or high-bitrate MP3. Mono is fine.
- Trim leading silence if it's easy; I'll do it anyway if not.
- Don't rename to match the list below exactly — just get it roughly in the
  right folder. I'll map filenames to events in the manifest.
- Multiple takes of the same thing are a *feature*, not clutter. Variations get
  randomized at playback so repeated sounds never feel machine-gunned.

## What goes where

### `dice/` — highest priority, most-heard sound in the game
- 5-8 short single-die impacts on wood/felt (60-150ms) -> randomized per die
- 2-3 longer rattles/throws (400-900ms) -> the roll itself
- optional: dice being scooped up / shaken in a cup

Search: `dice roll wood`, `dice shake cup`, `single die drop felt`, `dice clatter table`

### `coins/`
- 3+ single coin-on-wood impacts (60-150ms) -> the landing, randomized per coin
- a coin spinning down to rest on a hard surface (1-2s) -> the settle
- optional: coins chinking together in a hand

These take over from synthesis the moment they exist — the toss is
synthesised today only because there was nothing to sample.

Search: `coin drop wood`, `coin spin table`, `penny drop`, `coin chink`

### `chips/`
- single chip place, chip stack, chips sliding across felt, pot push
- 3+ variations of the single-chip sound if you can

Search: `poker chip single`, `poker chips stack`, `chips slide felt`

### `ui/`
Looked up by exact file name, so a rename here silently changes which sound
plays — `audio.test.ts` checks each name still matches:

- `soft_click` — every button press
- `pop` / `hard_click` — a die picked up / put down in Greed
- `notification` — your turn
- `happy_notify` — hot dice
- `error` — farkle
- `warn` — roulette's no more bets
- `ui_open` / `ui_close` — a dialog opening / shutting

Leading silence is skipped at playback, so it does not need trimming by hand.

### `stingers/` — short, 1-2s, not cartoonish
- your-turn bell (brass hand bell, small ding)
- win fanfare
- farkle / bust: a deflate or dull thud, more disappointment than comedy
- hot dice: something escalating and good

Search: `brass bell ding`, `small hand bell`, `wooden thud`

### `ambience/` — optional, off by default
- seamless tavern room tone loop, 30s+, low and unobtrusive
- fire crackle

Search: `tavern ambience loop`, `pub room tone`, `fireplace loop`

## Good sources
- **Freesound.org** — filter to CC0. Best for dice and chips.
- **Kenney.nl** — CC0 UI and casino packs.
- **Sonniss GDC bundles** — free, royalty-free, enormous.
- **Pixabay** — SFX section, licence-clean.
