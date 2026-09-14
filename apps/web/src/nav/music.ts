/**
 * The room's music, streamed from a YouTube playlist.
 *
 * Separate from audio.ts on purpose. That file is the game's own sound — short
 * samples and synthesised cues, played through one Web Audio graph we own.
 * This is somebody else's stream in somebody else's player, with its own
 * volume, its own failure modes and its own rules, and the two only meet at
 * the sliders in the navbar.
 *
 * Two things worth knowing about the embed. It must be allowed to remain
 * visible — YouTube's API terms are about a player people can see, not a
 * hidden audio source — so the player is rendered rather than tucked away.
 * And a browser will not always start audible playback without a gesture.
 * Music is on by default and stays on across a reload, so the page asks to
 * play as soon as it loads; whether that is allowed depends on the browser's
 * opinion of the site that day, which is why it only worked sometimes. When
 * it is refused, the next press anywhere on the page is the gesture, and the
 * stream starts then.
 */

import { isMuted } from "../game/audio.js";

const PLAYLIST = "PLDsQbZPR0jf4noTT0HceGJzcathrVAz9c";
const VOLUME_KEY = "backroom.music.volume";
const ON_KEY = "backroom.music.on";
const POSITION_KEY = "backroom.music.position";
const DEFAULT_VOLUME = 0.05;
/**
 * How long a remembered place in a track is worth going back to.
 *
 * Picking up mid-song is what a reload wants. Coming back tomorrow to the
 * second half of whatever was on last night is not continuity, it is a stale
 * bookmark.
 */
const RESUME_WITHIN_MS = 30 * 60 * 1000;
const REMEMBER_EVERY_MS = 5000;
/**
 * How long a start is given to become playback before it is nudged, one entry
 * per try.
 *
 * A reload sometimes leaves the embed parked, paused on its opening track,
 * when nothing was refused in so many words — and Stop then Play by hand
 * brought it straight back. So the page does the same on its own, a few times
 * and further apart each time, then leaves it to the next press rather than
 * poking a player that is never going to go.
 */
const NUDGE_AFTER_MS = [1500, 4000, 8000];
/** Pause and play in the same breath get folded into nothing by the embed. */
const NUDGE_GAP_MS = 250;

/** Only the handful of player methods this file actually calls. */
interface Player {
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  setVolume(percent: number): void;
  setShuffle(on: boolean): void;
  setLoop(on: boolean): void;
  getPlaylist(): string[] | undefined;
  playVideoAt(index: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getVideoData(): { title?: string; video_id?: string } | undefined;
  isMuted(): boolean;
  unMute(): void;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      height: string;
      width: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: { target: Player }) => void;
        onStateChange: (event: { data: number }) => void;
        onError?: () => void;
      };
    },
  ) => Player;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface MusicState {
  on: boolean;
  volume: number;
  /** True once the stream is actually sounding, which lags the switch. */
  playing: boolean;
  /** What is on, when the player has told us. */
  title: string | null;
  /** Set when the embed could not be loaded or refused to play. */
  failed: boolean;
}

interface Position {
  id: string;
  seconds: number;
  at: number;
}

/**
 * The player, once it is genuinely usable.
 *
 * Assigned from the ready event rather than from the constructor. What the
 * constructor hands back is not yet a player — its methods arrive with the
 * handshake — so calling setVolume on it throws, which is exactly what
 * happened every time the volume was set before the embed had finished
 * connecting. Null until ready means every call below simply waits.
 */
let player: Player | null = null;
/** A player asked for but not yet handed over, so it is not asked for twice. */
let building = false;
let loading: Promise<void> | null = null;
/** Where in the page the player should appear to be. */
let host: HTMLElement | null = null;
let showing = false;
/**
 * The player's real home: one element under the body, made once.
 *
 * It cannot live inside the navbar. React unmounts the bar on every route
 * change, and even if it did not, moving an iframe anywhere in the DOM makes
 * the browser reload it — which for a stream means the track restarts every
 * time you walk between rooms. So the iframe is created once, never moved, and
 * simply parked over the panel that pretends to contain it.
 */
let shell: HTMLDivElement | null = null;
/** Told when the pointer is over the player, which is not inside the panel. */
let onHover: ((over: boolean) => void) | null = null;
/**
 * Whether the stream has made an audible sound since this page loaded.
 *
 * Until it has, the browser may still be refusing to let it, so a press
 * anywhere is worth trying again on. It also guards the remembered position:
 * a page whose autoplay was refused is sitting at the top of some other track,
 * and writing that down on the way out would lose the place the reload before
 * it was trying to get back to.
 */
let heard = false;
let gestureArmed = false;
/** A remembered place to jump to once the track it belongs to starts. */
let pendingSeek: Position | null = null;
let nudges = 0;
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

const state: MusicState = {
  // On unless somebody has turned it off. The room is meant to have music in
  // it; the refusal browsers sometimes give is handled below, not avoided.
  on: read(ON_KEY, "true") === "true",
  // Quiet by default. Background music is background: loud enough to notice
  // once, not loud enough to talk over the table.
  volume: clamp(Number(read(VOLUME_KEY, String(DEFAULT_VOLUME)))),
  playing: false,
  title: null,
  failed: false,
};

const watchers = new Set<() => void>();

/*
 * A frozen copy handed to React, replaced only when something changes.
 *
 * useSyncExternalStore compares snapshots by identity: returning a fresh
 * object each time it asks would look like a change on every render and spin
 * forever. So the copy is made when the state moves, not when it is read.
 */
let snapshot: MusicState = { ...state };

function read(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A browser that will not remember is not a reason to refuse to play.
  }
}

/**
 * Whether the stream should be sounding right now.
 *
 * Two switches, and both have to be on. The music has its own — on by default
 * — and the speaker in the bar is a master mute over everything that makes
 * noise, which has to include this: a mute that silenced the dice and left a
 * jazz playlist running would not be a mute.
 */
function shouldPlay(): boolean {
  return state.on && !isMuted();
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
}

function announce(): void {
  snapshot = { ...state };
  for (const watcher of watchers) {
    watcher();
  }
}

export function musicState(): MusicState {
  return snapshot;
}

export function watchMusic(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

/**
 * Loads YouTube's player script, once.
 *
 * The API announces itself through a single global callback, so anything else
 * that wanted it would be clobbered — nothing else does, and this is the note
 * that says so rather than a surprise later.
 */
function loadApi(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    if (window.YT?.Player !== undefined) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("the music player would not load"));
    document.head.append(script);
  });
  return loading;
}

function makeShell(): HTMLDivElement {
  if (shell !== null) {
    return shell;
  }
  const element = document.createElement("div");
  element.id = "backroom-music";
  element.style.position = "fixed";
  element.style.zIndex = "40";
  element.style.overflow = "hidden";
  element.style.borderRadius = "2px";
  element.style.lineHeight = "0";
  park(element);
  /*
   * The player is not a descendant of the control that opens the panel — it
   * cannot be — so hovering it counts as leaving, and the panel closed the
   * moment the pointer reached the video. These put it back on the map.
   */
  element.addEventListener("mouseenter", () => onHover?.(true));
  element.addEventListener("mouseleave", () => onHover?.(false));
  document.body.append(element);
  // Capture, because the panel can sit inside a scrolling area of its own.
  window.addEventListener("scroll", place, { passive: true, capture: true });
  window.addEventListener("resize", place, { passive: true });
  shell = element;
  return element;
}

/** Out of the way, still sounding. */
function park(element: HTMLElement): void {
  element.style.left = "-10000px";
  element.style.top = "0";
  element.style.width = "1px";
  element.style.height = "1px";
  element.style.visibility = "hidden";
}

/**
 * Lays the player over the hole left for it in the panel.
 *
 * Cheap enough to call on every scroll — one rect read and a few style writes
 * — and only while the panel is open. The rest of the time the player is
 * parked off-screen, where it goes on playing with nothing to follow.
 */
export function place(): void {
  if (shell === null) {
    return;
  }
  const box = host !== null && showing ? host.getBoundingClientRect() : null;
  if (box === null || box.width === 0 || box.height === 0) {
    park(shell);
    return;
  }
  shell.style.left = `${box.left}px`;
  shell.style.top = `${box.top}px`;
  shell.style.width = `${box.width}px`;
  shell.style.height = `${box.height}px`;
  shell.style.visibility = "visible";
}

/**
 * Who to tell when the pointer moves on and off the player.
 *
 * The panel that appears to contain the player has to stay open while it is
 * being pointed at, and it cannot work that out for itself: as far as the DOM
 * is concerned the two are nowhere near each other.
 */
export function watchShellHover(handler: ((over: boolean) => void) | null): void {
  onHover = handler;
}

/**
 * Where the player should appear, and whether it should appear at all.
 *
 * The element handed in is only ever measured, never used as a parent — see
 * the note on `shell` for why the iframe cannot be put inside it. That is the
 * whole reason walking from the room to a table no longer restarts the track:
 * nothing about the player changes when the page around it is replaced.
 */
export function attachMusic(element: HTMLElement | null, open: boolean): void {
  host = element;
  showing = open && element !== null;
  if (shouldPlay() && player === null) {
    void build();
  }
  place();
}

const GESTURES = ["pointerup", "touchend", "keyup"] as const;

/**
 * Waits for the press that lets the browser play.
 *
 * Captured on the window so a control that stops propagation still counts.
 * The retry is put off a tick so the press finishes first: if it was the mute
 * button or Stop, the switches have already moved by the time this looks at
 * them, and a stream about to be told to stop is never started.
 */
function armGesture(): void {
  if (gestureArmed || heard) {
    return;
  }
  gestureArmed = true;
  for (const name of GESTURES) {
    window.addEventListener(name, onGesture, { capture: true, passive: true });
  }
}

function disarmGesture(): void {
  if (!gestureArmed) {
    return;
  }
  gestureArmed = false;
  for (const name of GESTURES) {
    window.removeEventListener(name, onGesture, { capture: true });
  }
}

function onGesture(): void {
  window.setTimeout(resume, 0);
}

function resume(): void {
  if (heard || !shouldPlay()) {
    return;
  }
  if (player === null) {
    void build();
    return;
  }
  // A browser that refuses sound will sometimes allow the video muted instead,
  // which looks like playing and sounds like nothing.
  player.unMute();
  if (!state.playing) {
    start();
  }
}

/** Writes down what is on and how far in, so a reload can come back to it. */
function remember(): void {
  if (!heard || player === null) {
    return;
  }
  const id = player.getVideoData()?.video_id;
  const seconds = player.getCurrentTime();
  if (typeof id !== "string" || id.length === 0 || !Number.isFinite(seconds)) {
    return;
  }
  const position: Position = { id, seconds, at: Date.now() };
  write(POSITION_KEY, JSON.stringify(position));
}

function recalled(): Position | null {
  try {
    const parsed: unknown = JSON.parse(read(POSITION_KEY, "null"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "seconds" in parsed &&
      "at" in parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.seconds === "number" &&
      typeof parsed.at === "number" &&
      Date.now() - parsed.at < RESUME_WITHIN_MS
    ) {
      return { id: parsed.id, seconds: parsed.seconds, at: parsed.at };
    }
  } catch {
    // Somebody else's idea of a position is no position.
  }
  return null;
}

async function build(): Promise<void> {
  if (player !== null || building) {
    return;
  }
  building = true;
  armGesture();
  try {
    await loadApi();
  } catch {
    building = false;
    state.failed = true;
    announce();
    return;
  }
  const api = window.YT;
  if (api?.Player === undefined) {
    building = false;
    state.failed = true;
    announce();
    return;
  }

  const mount = document.createElement("div");
  makeShell().append(mount);

  new api.Player(mount, {
    width: "220",
    height: "124",
    playerVars: {
      listType: "playlist",
      list: PLAYLIST,
      // Not asked for here: the opening track is chosen in start(), and the
      // browser's refusal is handled there rather than inside the embed.
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
    },
    events: {
      onReady: (event) => {
        player = event.target;
        building = false;
        player.setVolume(Math.round(state.volume * 100));
        player.setLoop(true);
        player.setShuffle(true);
        // A reload gives no warning, so the place is written down as it goes
        // as well as on the way out; pagehide is not promised to every tab.
        window.setInterval(remember, REMEMBER_EVERY_MS);
        window.addEventListener("pagehide", remember);
        // Muted between asking for the player and getting one is unlikely but
        // entirely possible, and starting anyway would be the one case where
        // the mute button does not mute.
        if (shouldPlay()) {
          start();
        }
      },
      onStateChange: (event) => {
        const playing = event.data === (window.YT?.PlayerState.PLAYING ?? 1);
        state.playing = playing;
        const data = player?.getVideoData();
        const title = data?.title;
        state.title = typeof title === "string" && title.length > 0 ? title : null;
        if (playing && player !== null) {
          // Seeking only means anything once the track is loaded, and only on
          // the track the place was remembered in.
          if (pendingSeek !== null) {
            if (data?.video_id === pendingSeek.id) {
              player.seekTo(pendingSeek.seconds, true);
            }
            pendingSeek = null;
          }
          if (!player.isMuted()) {
            heard = true;
            disarmGesture();
          }
        }
        remember();
        announce();
        // The panel may have opened while the embed was still building.
        place();
      },
      onError: () => {
        // One dead video should not end the night; the playlist moves on.
        player?.nextVideo();
      },
    },
  });
}

/**
 * Picks the opening track: the one that was on before a reload, or somewhere
 * other than the top.
 *
 * setShuffle alone is unreliable before a playlist has loaded, and even when
 * it takes it leaves the first track playing first — so the opening track is
 * chosen here as well. Between the two, two people opening the room at the
 * same time are not listening to the same thing.
 */
function start(): void {
  if (player === null) {
    return;
  }
  const list = player.getPlaylist();
  const previous = recalled();
  const index = previous !== null && Array.isArray(list) ? list.indexOf(previous.id) : -1;
  if (previous !== null && index >= 0) {
    pendingSeek = previous;
    player.playVideoAt(index);
  } else if (Array.isArray(list) && list.length > 1) {
    player.playVideoAt(Math.floor(Math.random() * list.length));
  } else {
    player.playVideo();
  }
  scheduleNudge();
}

function scheduleNudge(): void {
  clearTimeout(nudgeTimer);
  const delay = NUDGE_AFTER_MS[nudges];
  if (delay === undefined || heard) {
    return;
  }
  nudgeTimer = setTimeout(nudge, delay);
}

/** Whether a start has still not turned into playback that anybody can hear. */
function stuck(target: Player): boolean {
  return player === target && !heard && !state.playing && shouldPlay();
}

/**
 * Stop then Play, done for the player.
 *
 * Only while the stream is meant to be on and is not playing: a start that
 * took, or a switch turned off in the meantime, ends it. The same track is
 * resumed rather than a new one chosen, so a remembered place still waiting to
 * be sought to is not thrown away.
 */
function nudge(): void {
  nudgeTimer = undefined;
  const target = player;
  if (target === null || !stuck(target)) {
    return;
  }
  nudges += 1;
  target.pauseVideo();
  nudgeTimer = setTimeout(() => {
    nudgeTimer = undefined;
    if (!stuck(target)) {
      return;
    }
    target.playVideo();
    scheduleNudge();
  }, NUDGE_GAP_MS);
}

export function setMusicOn(on: boolean): void {
  state.on = on;
  state.failed = false;
  write(ON_KEY, String(on));
  announce();
  applyPlayback();
}

/**
 * Brings the stream into line with the two switches.
 *
 * Called by the music's own toggle and by the master mute, which lives in the
 * game's audio module and knows nothing about YouTube.
 */
export function applyPlayback(): void {
  if (!shouldPlay()) {
    player?.pauseVideo();
    return;
  }
  if (player === null) {
    void build();
  } else if (!heard) {
    // Nothing has sounded yet, so nothing is paused: the opening track, and
    // any place remembered in it, has still to be chosen.
    player.unMute();
    start();
  } else {
    player.playVideo();
  }
}

export function setMusicVolume(next: number): void {
  state.volume = clamp(next);
  write(VOLUME_KEY, String(state.volume));
  player?.setVolume(Math.round(state.volume * 100));
  announce();
}

/** On to the next track, for when this one is not it. */
export function skipTrack(): void {
  player?.nextVideo();
}
