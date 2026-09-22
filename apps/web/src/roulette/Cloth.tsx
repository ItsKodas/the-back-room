import { colourOf, pays, spotAt } from "@backroom/game-roulette";
import { useEffect, useRef, useState } from "react";
import { ChipStack } from "../chips/ChipStack.js";
import { ANCHORS, BOXES, HEIGHT, SQUARES, WIDTH, boxOf, nearest } from "./layout.js";

/**
 * The betting cloth.
 *
 * A tap lands on the nearest thing that can be bet on — a square, the line
 * between two, or the point where four meet — so a chip sits where it would on
 * a real table rather than in a menu of bet names. All of that arithmetic
 * lives in cloth.ts; this draws it and turns a pointer into a spot.
 *
 * The one thing that is decided here is which way round it goes. Laid out as a
 * casino prints it, the cloth is fourteen squares wide and five tall, which on
 * a phone leaves squares about twenty-six pixels across — too small to read,
 * never mind aim at. Turned on its side it is five across, which is
 * seventy-five. So a narrow screen gets a portrait cloth, and because the
 * geometry is in grid units rather than pixels, that is one swap here and no
 * second set of figures anywhere.
 */

/**
 * The width at which the cloth lies down.
 *
 * Fourteen squares need about this much before a square is worth aiming at;
 * below it the cloth is turned and five squares have the width instead.
 */
export const TURNS_AT = 560;

/**
 * How long a press has to be held before it means "take this back".
 *
 * Long enough not to catch a firm tap, short enough that somebody who meant it
 * is not left wondering. The same threshold a browser uses to raise its own
 * context menu on touch, which is the gesture this replaces.
 */
export const HOLD_MS = 500;

export interface Placed {
  seatId: string;
  spotId: string;
  chips: number;
}

export function Cloth({
  placed,
  mine,
  onPlace,
  onTake,
  disabled = false,
  landed,
  portrait,
}: {
  placed: readonly Placed[];
  /** Which seat is yours, so your chips can be told from everybody else's. */
  mine: string | null;
  onPlace?: (spotId: string) => void;
  /**
   * Takes chips back off a spot.
   *
   * Right-click, which is the other half of placing by aiming: the pointer is
   * already over the chip you mean, so reaching for a button to undo it is a
   * journey away from the thing you are looking at. A long press does the same
   * thing, because a phone has no second button — browsers raise the same
   * context-menu event for both, which is why one handler covers it.
   */
  onTake?: (spotId: string) => void;
  disabled?: boolean;
  /**
   * The pocket the ball has come to rest in, so the winning number can be lit.
   *
   * Named for the thing that has happened rather than for the value, because
   * the value exists long before it: the server picks the pocket the moment
   * betting closes and sends it out so the wheel can roll to it. Passing that
   * through here while the ball is still travelling lights the winning square
   * on the cloth several seconds early and gives the result away. Null until
   * it has landed.
   */
  landed?: number | null;
  /** Forces the orientation. Left off, the cloth works it out for itself. */
  portrait?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);

  /*
   * The press in progress: what it is aimed at, and whether it has been held
   * long enough to mean a take-back.
   *
   * One object rather than three states, because they change together and a
   * render that had the new spot and the old "held" would name one bet and
   * take back another.
   */
  const [press, setPress] = useState<{ spotId: string | null; held: boolean } | null>(null);
  /* Hover, which is a desk's way of asking the same question and costs nothing. */
  const [hovered, setHovered] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endPress = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPress(null);
  };

  useEffect(
    () => () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    },
    [],
  );

  /*
   * Which way round the cloth goes, decided by the cloth from its own width.
   *
   * Its own width rather than the viewport's, because this is a question about
   * the room it was given and not about the device: the same cloth is narrow
   * beside a wheel on a desk and wide on a tablet held sideways. Below the
   * threshold a landscape cloth gives squares around twenty-four pixels, which
   * is under a thumb and under legibility both.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const cloth = box.current;
    if (cloth === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) {
        setNarrow(width < TURNS_AT);
      }
    });
    watch.observe(cloth);
    return () => watch.disconnect();
  }, []);

  const sideways = portrait ?? narrow;

  /**
   * Turns a pointer somewhere on the cloth into the spot it is aimed at.
   *
   * Takes the two numbers it actually needs rather than a particular kind of
   * event, because the same question is asked of a pointer press and of a
   * context menu, and those arrive as different event types.
   */
  const spotUnder = (event: { clientX: number; clientY: number }): string | null => {
    const cloth = box.current;
    if (cloth === null) {
      return null;
    }
    const rect = cloth.getBoundingClientRect();
    const across = (event.clientX - rect.left) / rect.width;
    const down = (event.clientY - rect.top) / rect.height;
    /*
     * Back into grid units, undoing the rotation if there is one.
     *
     * The cloth is turned a quarter clockwise, so its left edge — the zero —
     * ends up at the top. That direction rather than the other because the
     * zero is where a cloth starts, and a player scrolling down should be
     * reading 1, 2, 3 away from it rather than arriving at 36 first.
     */
    return sideways
      ? nearest(down * WIDTH, (1 - across) * HEIGHT)
      : nearest(across * WIDTH, down * HEIGHT);
  };

  /** Where a spot's chips are drawn, as a percentage of the cloth. */
  const placeAt = (x: number, y: number) =>
    sideways
      ? { left: `${(1 - y / HEIGHT) * 100}%`, top: `${(x / WIDTH) * 100}%` }
      : { left: `${(x / WIDTH) * 100}%`, top: `${(y / HEIGHT) * 100}%` };

  /** A rectangle on the cloth, drawn the right way round. */
  const spanAt = (x: number, y: number, width: number, height: number) =>
    sideways
      ? {
          left: `${(1 - (y + height) / HEIGHT) * 100}%`,
          top: `${(x / WIDTH) * 100}%`,
          width: `${(height / HEIGHT) * 100}%`,
          height: `${(width / WIDTH) * 100}%`,
        }
      : {
          left: `${(x / WIDTH) * 100}%`,
          top: `${(y / HEIGHT) * 100}%`,
          width: `${(width / WIDTH) * 100}%`,
          height: `${(height / HEIGHT) * 100}%`,
        };

  /* Everybody's chips, gathered per spot so one pile stands for one bet. */
  const piles = new Map<string, { chips: number; yours: number }>();
  for (const one of placed) {
    const already = piles.get(one.spotId) ?? { chips: 0, yours: 0 };
    piles.set(one.spotId, {
      chips: already.chips + one.chips,
      yours: already.yours + (one.seatId === mine ? one.chips : 0),
    });
  }

  const showing = press?.spotId ?? hovered;
  const aimed = showing === null ? null : spotAt(showing);
  const taking = press?.held === true;

  return (
    <div
      className={`rl__cloth${sideways ? " rl__cloth--portrait" : ""}${
        disabled ? " rl__cloth--shut" : ""
      }`}
      /*
       * A group rather than a plain box, because it is one control with many
       * targets: the lines and the four-way points a chip can sit on are not
       * elements and cannot be, so the surface answers for all of them.
       *
       * Aiming is a pointer's talent and nothing else's, which is why the real
       * keyboard route is the list of buttons at the end of this component
       * rather than anything bolted onto this div. Placing a bet is not
       * something a person should need a mouse for.
       */
      role="group"
      aria-label="The betting cloth"
      ref={box}
      style={{ aspectRatio: sideways ? `${HEIGHT} / ${WIDTH}` : `${WIDTH} / ${HEIGHT}` }}
      onPointerDown={(event) => {
        /*
         * Only the primary button aims. A right-click is on its way to a
         * context menu, and without this it puts a chip down on the way to
         * taking one off — the pile never shrinks.
         */
        if (disabled || event.button !== 0) {
          return;
        }
        // Capture, so a finger that slides off an element inside the cloth
        // keeps reporting to the cloth. The opposite of Plinko's drop key,
        // which refuses capture because sliding off is its escape — here
        // sliding is how you aim, and lifting outside is the escape.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setPress({ spotId: spotUnder(event), held: false });
        holdTimer.current = setTimeout(() => {
          setPress((was) => (was === null ? null : { ...was, held: true }));
        }, HOLD_MS);
      }}
      onPointerMove={(event) => {
        if (press === null) {
          setHovered(spotUnder(event));
          return;
        }
        const spot = spotUnder(event);
        setPress((was) => (was === null || was.spotId === spot ? was : { ...was, spotId: spot }));
      }}
      onPointerUp={(event) => {
        if (press === null) {
          return;
        }
        const { spotId, held } = press;
        endPress();
        // Lifted off the cloth entirely: the way out of a press you did not mean.
        if (spotId === null || spotUnder(event) === null) {
          return;
        }
        if (held) {
          onTake?.(spotId);
        } else {
          onPlace?.(spotId);
        }
      }}
      onPointerCancel={endPress}
      onPointerLeave={() => setHovered(null)}
      onContextMenu={(event) => {
        // The browser's own menu is never what somebody wants over a chip.
        event.preventDefault();
        if (disabled) {
          return;
        }
        const spot = spotUnder(event);
        if (spot !== null) {
          onTake?.(spot);
        }
      }}
    >
      {/* The numbers. */}
      {SQUARES.map((square) => {
        const colour = colourOf(square.n);
        const won = landed === square.n;
        return (
          <div
            key={square.n}
            className={`rl__square rl__square--${colour ?? "zero"}${won ? " rl__square--won" : ""}`}
            style={spanAt(square.x, square.y, 1, square.n === 0 ? 3 : 1)}
          >
            <span>{square.n}</span>
          </div>
        );
      })}

      {/* The outside bets, which are areas rather than lines. */}
      {BOXES.map((one) => (
        <div
          key={one.spotId}
          className={`rl__outside${dressOf(one.label)}`}
          style={spanAt(one.x, one.y, one.width, one.height)}
        >
          <span>{one.label}</span>
        </div>
      ))}

      {/*
       * What the current aim would buy, drawn before it costs anything. The
       * whole answer to the one risk in this way of placing chips: you always
       * see the bet you are about to make, named, before you make it.
       */}
      {aimed === null || disabled ? null : (
        <div
          className={`rl__aim${taking ? " rl__aim--taking" : ""}`}
          style={placeAt(...aimAt(aimed.id))}
        >
          <span className="rl__aim-name">
            {taking ? "Release to take it back" : `${aimed.label}, pays ${pays(aimed)} to 1`}
          </span>
        </div>
      )}

      {/*
       * Where the chip a press is naming would land. Under the name rather
       * than instead of it — the name says what the bet is and this says
       * where it goes, and a press wants both before it costs anything.
       */}
      {press?.spotId == null || disabled ? null : (
        <div className="rl__ghost" style={placeAt(...aimAt(press.spotId))} aria-hidden="true" />
      )}

      {/* The chips. */}
      {[...piles.entries()].map(([spotId, pile]) => (
        <div
          key={spotId}
          className={`rl__pile${pile.yours > 0 ? " rl__pile--yours" : ""}${
            boxOf(spotId) === null ? "" : " rl__pile--outside"
          }`}
          style={placeAt(...aimAt(spotId))}
        >
          {/* Small: a chip on a cloth sits on a printed label, and a pile
              drawn at tray size buries the word it is standing on. */}
          <ChipStack amount={pile.chips} width={22} most={3} tallest={3} />
        </div>
      ))}

      {/*
        Every bet on the cloth, as a real control.

        Aiming a chip at the point where four squares meet is something a
        pointer can do and a keyboard cannot, so the cloth on its own is a
        table only some people can play at. This is the same 157 bets as
        buttons: off screen, in the tab order, each one saying what it is and
        what is already on it. The felt above is the quick way to reach them,
        not the only way.
      */}
      <div className="rl__reach">
        {ANCHORS.map((anchor) => {
          const spot = spotAt(anchor.spotId);
          if (spot === null) {
            return null;
          }
          const on = piles.get(spot.id)?.chips ?? 0;
          return (
            <button
              key={spot.id}
              type="button"
              disabled={disabled}
              onClick={() => onPlace?.(spot.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onTake?.(spot.id);
              }}
            >
              {`${spot.label}, pays ${pays(spot)} to 1${on > 0 ? `, ${on} on it` : ""}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * How an outside box is painted, from what it says.
 *
 * The two colour bets wear their own colour, because that is what a printed
 * cloth does — you back red by putting a chip on the red box, without reading
 * a word. The column boxes get their own class because one square is not
 * enough room for anything but the shorthand.
 *
 * Keyed off the label deliberately: the label is what the box shows, and a
 * check against anything else can go stale without the box changing. One
 * already did — this tested for "2 to 1" for a while after the cloth had
 * started saying "2:1", and quietly styled nothing.
 */
function dressOf(label: string): string {
  switch (label) {
    case "Red":
      return " rl__outside--red";
    case "Black":
      return " rl__outside--black";
    case "2:1":
      return " rl__outside--column";
    default:
      return "";
  }
}

/** Built once: every spot's anchor, by id, for drawing chips on. */
const ANCHOR_BY_ID = new Map(ANCHORS.map((one) => [one.spotId, one]));

/** Where a spot's chips sit, in grid units. */
function aimAt(spotId: string): [number, number] {
  const anchor = ANCHOR_BY_ID.get(spotId);
  return anchor === undefined ? [0, 0] : [anchor.x, anchor.y];
}
