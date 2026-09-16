import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChipMark } from "../chips/Chip.js";
import { Digits } from "../game/Digits.js";
import { play } from "../game/audio.js";
import { Avatar } from "../game/Avatar.js";
import { throughTheDoor } from "../game/doors.js";
import { compact, exact } from "../game/money.js";
import { Sign } from "../game/Sign.js";
import type { Account } from "../game/useAccount.js";
import { CopyCode } from "./CopyCode.js";
import { Install } from "./Install.js";
import { Sound } from "./Sound.js";

/** The table you are sitting at, when you are sitting at one. */
export interface NavTable {
  code: string;
  onLeave: () => void;
  /** Set while a game is running, so leaving asks once before forfeiting. */
  confirm?: boolean;
}

export interface NavbarProps {
  /**
   * The game's name as it is written — Greed sets one letter alight, so this
   * is markup rather than a string. Absent in the room and on your own page.
   */
  game?: ReactNode;
  table?: NavTable;
  account: Account;
  /**
   * Whether the socket is up. Undefined on pages with no socket at all, which
   * is different from being disconnected and shows nothing rather than a fault.
   */
  connected?: boolean;
}

/**
 * The bar across the top of every page.
 *
 * One component rather than a header per page, because a building with a
 * different bar in each room is not one building. Everything in it is either
 * the building's (the sign, your face, your chips, the sound) or this table's
 * (the game, the code, the way out) — and the second half simply is not there
 * when you are not at a table.
 */
export function Navbar({ game, table, account, connected }: NavbarProps) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useId();

  // Walking somewhere is the menu having done its job.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value read — arriving somewhere new is what shuts the menu, and without it in the list this would run once and never again
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (event: Event) => {
      if (!bar.current?.contains(event.target as Node)) {
        shut();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        shut();
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", onKey);
    };
  });

  function shut() {
    play("close");
    setOpen(false);
  }

  return (
    <header className="nav" ref={bar}>
      {/* Groups rather than a row of loose children. On a desk the menu is
          not a box at all and its groups sit on the bar; on a phone the same
          elements drop down under the chips. One set of controls either way,
          because Sound owns the music player and a second copy would fight
          it for the stage. */}
      <div className="nav__brand">
        <h1 className="nav__mark">
          <Link
            to="/"
            aria-label="The Back Room"
            onClick={(event) => {
              // Already in the room, the sign goes nowhere and nothing shuts.
              if (pathname !== "/") {
                throughTheDoor(event, "close");
              }
            }}
          >
            <Sign />
          </Link>
        </h1>
        {game !== undefined ? <span className="nav__game">{game}</span> : null}
      </div>

      {/* Only shown on a phone: your chips, and a caret saying there is more. */}
      <button
        ref={trigger}
        type="button"
        className="nav__trigger"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={menu}
        onClick={() => {
          play(open ? "close" : "open");
          setOpen(!open);
        }}
      >
        <Badge account={account} />
        <CaretIcon />
      </button>

      <div id={menu} className="nav__menu" data-open={open || undefined}>
        <div className="nav__who">
          {/* The table you are at, as one object — the same shape as the account
              beside it, because both are a thing you are in rather than a control.
              Leaving lives inside it: the way out belongs to the table, not to
              the bar, and it says "Leave" rather than only drawing an arrow. */}
          {table !== undefined ? (
            <span className="nav__table">
              <CopyCode code={table.code} />
              <LeaveButton table={table} />
            </span>
          ) : null}
          <Who account={account} />
        </div>

        <div className="nav__keys">
          {account.admin ? (
            <Link to="/admin" className="key key--icon" aria-label="Admin desk" title="Admin desk">
              <KeyIcon />
            </Link>
          ) : null}
          <Install />
          <Sound />
        </div>
      </div>

      {/* Last, so it is the far corner of the bar at every width. */}
      {connected === undefined ? null : <Connection up={connected} />}
    </header>
  );
}

/**
 * The way out.
 *
 * Mid-game there is a turn to forfeit, so the first press arms it and the
 * second one leaves — and it disarms itself after a moment, so a stray click
 * on the way past is not a trap left lying about. In a lobby there is nothing
 * to lose and one press is enough.
 */
function LeaveButton({ table }: { table: NavTable }) {
  const [arming, setArming] = useState(false);
  const risky = table.confirm === true;

  useEffect(() => {
    if (!arming) {
      return;
    }
    const timer = setTimeout(() => setArming(false), 3000);
    return () => clearTimeout(timer);
  }, [arming]);

  const label = arming ? "Leave — sure?" : "Leave table";
  return (
    <button
      type="button"
      className={`nav__leave${arming ? " nav__leave--warn" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => {
        if (!risky || arming) {
          table.onLeave();
          return;
        }
        setArming(true);
      }}
    >
      <LeaveIcon />
      <span>{arming ? "Sure?" : "Leave"}</span>
    </button>
  );
}

/**
 * Who you are, as one object.
 *
 * Your face, name and balance read as a single thing because they are — and
 * the pill is a link to your own page, since that is the only place it would
 * sensibly lead. Signing out sits outside it, small: present, never prominent.
 */
function Who({ account }: { account: Account }) {
  if (account.loading) {
    return null;
  }
  if (account.profile === null) {
    /*
     * A key either way, never a sentence about being a guest: signing in is
     * the thing a guest can do about it. On a server with no Discord
     * credentials the key is still there but down, and says why, rather than
     * leading to an endpoint that only answers that sign-in is not set up.
     */
    return account.available ? (
      <a className="key key--small" href="/auth/discord">
        Sign in
      </a>
    ) : (
      <button
        type="button"
        className="key key--small"
        disabled
        title="Sign-in is not set up on this server"
        aria-description="Sign-in is not set up on this server"
      >
        Sign in
      </button>
    );
  }

  const low = account.profile.chips < 2000;
  return (
    <>
      <Link to="/me" className="me" title="Your profile">
        <Avatar
          name={account.profile.name}
          avatar={account.profile.avatar}
          accentColor={account.profile.accentColor}
          className="me__face"
        />
        <span className="me__name">{account.profile.name}</span>
        {/*
          * Short, because this is glanced at rather than read: at seven digits
          * the exact figure is not what the glance is for, and the pill grows
          * every time somebody wins. The full number stays on the title, and
          * the profile page it links to writes it out.
          */}
        <span className="me__chips" title={`${exact(account.profile.chips)} chips`}>
          <ChipMark />
          {/*
            * Rolled rather than replaced, so a win reads as chips arriving
            * rather than as a number that was suddenly different. Only the
            * columns that changed turn, which is what makes it a counter on a
            * machine instead of text being swapped out.
            */}
          <Digits value={compact(account.profile.chips)} />
        </span>
      </Link>
      {low ? (
        <Link className="key key--small" to="/tips">
          Tip jar
        </Link>
      ) : null}
    </>
  );
}

/**
 * Whether the table can still hear you.
 *
 * Nothing is said while it is fine. A green light that is always on is the
 * same as no light at all, and it spends attention every second to tell you
 * something you already assumed — so the ordinary state is a quiet dot, and
 * only trouble is lit and moving. Not worded on the bar, where the word cost
 * a phone the room it needed for the sign; the word is still what a screen
 * reader hears and what a pointer finds on the title.
 */
function Connection({ up }: { up: boolean }) {
  const said = up ? "Connected" : "Offline";
  return (
    <span className={`nav__link${up ? "" : " nav__link--down"}`} role="img" aria-label={said} title={said}>
      <i className="nav__dot" />
    </span>
  );
}

/**
 * What the phone's menu button wears: your face and chips, the same glance
 * the pill gives on a desk, or simply "Guest". Nothing while still asking,
 * rather than a guess at who you are that gets taken back.
 */
function Badge({ account }: { account: Account }) {
  if (account.loading) {
    return null;
  }
  if (account.profile === null) {
    return <span className="nav__trigger-guest">Guest</span>;
  }
  return (
    <>
      <Avatar
        name={account.profile.name}
        avatar={account.profile.avatar}
        accentColor={account.profile.accentColor}
        className="me__face"
      />
      <span className="nav__trigger-chips">
        <ChipMark />
        <Digits value={compact(account.profile.chips)} />
      </span>
    </>
  );
}

function CaretIcon() {
  return (
    <svg
      className="nav__caret"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function KeyIcon() {
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
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2" />
      <path d="m16 7 3 3" />
      <path d="m19 4 2 2" />
    </svg>
  );
}

function LeaveIcon() {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
