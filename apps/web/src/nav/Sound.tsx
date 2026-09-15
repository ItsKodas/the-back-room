import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getVolume, isMuted, setMuted, setVolume, unlock } from "../game/audio.js";
import {
  applyPlayback,
  attachMusic,
  musicState,
  setMusicOn,
  setMusicVolume,
  skipTrack,
  watchMusic,
  watchShellHover,
} from "./music.js";

/**
 * Sound, folded into a single button.
 *
 * A pair of sliders on the bar would be two controls nobody touches taking the
 * width of ones they would — so this is a speaker you click to mute and hover
 * to open. Inside are the two things that make noise and have nothing to do
 * with each other: the game, which is ours, and the music, which is a stream
 * from somewhere else.
 *
 * The panel is always in the DOM rather than mounted on hover. A control that
 * appears only once a pointer arrives cannot be reached by a keyboard, and
 * :focus-within opens the same panel for anyone tabbing to it — and the music
 * player must not be unmounted, because rebuilding the iframe would restart
 * the track every time the menu closed.
 */
export function Sound() {
  const [level, setLevel] = useState(() => getVolume());
  const [muted, setMutedHere] = useState(() => isMuted());
  const music = useSyncExternalStore(watchMusic, musicState);

  const move = (next: number) => {
    unlock();
    setVolume(next);
    setLevel(next);
    // Reaching for a slider is asking to hear something. Leaving it silent
    // while the number climbs would look broken, which it very nearly is.
    if (muted && next > 0) {
      flip(false);
    }
  };

  /**
   * The master mute: everything that makes a noise, including the stream.
   *
   * It is a switch rather than a volume of zero, so both sliders stay exactly
   * where they were and unmuting does not have to guess where that was.
   */
  const flip = (next: boolean) => {
    setMuted(next);
    setMutedHere(next);
    applyPlayback();
  };

  /*
   * Whether the panel is open, tracked in JavaScript as well as in CSS.
   *
   * The player is not inside the panel — it cannot be, or navigating between
   * pages would reload the iframe and restart the track — so it is laid over
   * the gap left for it, and something has to say when that gap is on screen.
   */
  const [open, setOpen] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const closing = useRef<number | null>(null);

  /*
   * Opening and closing with a moment's grace.
   *
   * The pointer has to cross between two elements that are not related in the
   * DOM — the control, and the player laid over the gap in it — and every
   * crossing is a leave immediately followed by an enter. Closing on the leave
   * shut the panel in the middle of the journey; waiting a beat and letting
   * the enter cancel it does not.
   */
  const hold = (wanted: boolean) => {
    if (closing.current !== null) {
      window.clearTimeout(closing.current);
      closing.current = null;
    }
    if (wanted) {
      setOpen(true);
      return;
    }
    closing.current = window.setTimeout(() => {
      closing.current = null;
      setOpen(false);
    }, 160);
  };

  useEffect(() => {
    attachMusic(stage.current, open);
    // Unmounting is a page change, not a reason to stop: the player is parked
    // off-screen and goes on playing until the next bar picks it up.
    return () => attachMusic(null, false);
  }, [open]);

  useEffect(() => {
    watchShellHover(hold);
    return () => watchShellHover(null);
  });

  return (
    <span
      className={`vol${muted ? " vol--muted" : ""}${open ? " vol--open" : ""}`}
      /* A named group rather than a bare span: it carries the pointer and
         focus handlers that decide whether the panel is open, and the things
         inside it are one set of controls rather than several. */
      role="group"
      aria-label="Sound"
      onMouseEnter={() => hold(true)}
      onMouseLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={(event) => {
        // Only when focus has actually left the whole control, not when it
        // moves from one slider to the other.
        if (!event.currentTarget.contains(event.relatedTarget)) {
          hold(false);
        }
      }}
    >
      <button
        type="button"
        className="key key--icon vol__btn"
        aria-label={muted ? "Unmute everything" : "Mute everything"}
        title={muted ? "Unmute" : "Mute"}
        onClick={() => flip(!muted)}
      >
        {muted ? <MutedIcon /> : <SpeakerIcon />}
      </button>

      <div className="vol__pop">
        <div className="vol__row">
          <span className="vol__label">Game</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={level}
            aria-label="Game volume"
            onChange={(event) => move(Number(event.target.value))}
          />
          <span className="vol__read">{Math.round(level * 100)}</span>
        </div>

        <div className="vol__row">
          <span className="vol__label">Music</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={music.volume}
            aria-label="Music volume"
            onChange={(event) => {
              setMusicVolume(Number(event.target.value));
              if (muted) {
                flip(false);
              }
            }}
          />
          <span className="vol__read">{Math.round(music.volume * 100)}</span>
        </div>

        <div className="vol__music">
          <button
            type="button"
            className="key key--small"
            onClick={() => setMusicOn(!music.on)}
          >
            {music.on ? "Stop" : "Play"}
          </button>
          <button
            type="button"
            className="key key--icon"
            aria-label="Next track"
            title="Next track"
            disabled={!music.on}
            onClick={skipTrack}
          >
            <SkipIcon />
          </button>
          <span className="vol__now">
            {music.failed
              ? "the stream would not load"
              : !music.on
                ? "off"
                : muted
                  ? "muted"
                  : (music.title ?? "finding something…")}
          </span>
        </div>

        {/* Kept in the layout rather than hidden: a stream is somebody else's
            player and is meant to be seen, not run as a hidden source. */}
        {/* A hole the player is laid over, rather than a box it sits in. It
            keeps its size while empty, because it is always empty. */}
        <div className={`vol__stage${music.on && !muted ? "" : " vol__stage--off"}`} ref={stage} />
      </div>
    </span>
  );
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}
