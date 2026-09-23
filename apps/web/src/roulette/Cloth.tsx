import type { Kind } from "@backroom/game-roulette";
import { colourOf, pays, spotAt } from "@backroom/game-roulette";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * Two things are decided here. Which way round it goes: laid out as a casino
 * prints it the cloth is fourteen squares wide and five tall, which on a phone
 * leaves squares about twenty-six pixels across — too small to read, never
 * mind aim at — and turned on its side it is five across, which is sixty-odd.
 * Because the geometry is in grid units rather than pixels, that is one swap
 * here and no second set of figures anywhere.
 *
 * And where it has been pushed to. The cloth fills the room it is given, so on
 * a phone the whole board is on screen at once and the rows are short; a pinch
 * takes you in for a split or a corner and a drag moves the board under your
 * thumb, the way a map does. All of that is a transform on one element, and
 * the aiming below does not know it is happening: the rectangle a browser
 * reports for a transformed element is already the one you can see.
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

/**
 * How far a finger may travel before it stops being a bet.
 *
 * The one genuinely risky thing about letting the cloth be dragged: a press
 * and a drag begin identically, and the wrong reading either puts a chip
 * somewhere nobody meant or refuses to move a board somebody is pushing. Ten
 * pixels is under a deliberate swipe and over the wobble in a firm tap.
 */
export const SLOP = 10;

/**
 * How far into the cloth a pinch may go.
 *
 * Three is where a square stops getting more useful: on a 375px phone that is
 * a 220x95 number, and the point of going in was a split you could aim at, not
 * a number you could read from the bar.
 */
export const MOST_ZOOM = 3;

/** A scale and an offset, in the cloth's own untransformed pixels. */
interface View {
  k: number;
  x: number;
  y: number;
}

const FIT: View = { k: 1, x: 0, y: 0 };

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
  onAim,
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
  /** What the cloth is currently aimed at, so a payout sheet can light its row. */
  onAim?: (kind: Kind | null) => void;
}) {
  /**
   * The three boxes this is drawn in, and why there are three.
   *
   * `frame` is the room: it never moves, it is what clips a cloth pushed
   * about inside it, and it is the only one of the three whose width does not
   * depend on which way round the cloth went — which is what makes it the
   * thing to measure. `roam` carries the pan and the zoom, and nothing else,
   * so React never writes a style to it and a transform set on it during a
   * drag cannot be thrown away by a re-render. `felt` is the surface: the
   * squares, the chips, and the rectangle every press is measured against.
   */
  const frame = useRef<HTMLDivElement>(null);
  const roam = useRef<HTMLDivElement>(null);
  const felt = useRef<HTMLDivElement>(null);

  /*
   * The press in progress: which pointer owns it, what it is aimed at, and
   * whether it has been held long enough to mean a take-back.
   *
   * One object rather than three states, because they change together and a
   * render that had the new spot and the old "held" would name one bet and
   * take back another.
   *
   * `pointerId` is carried so a second finger can never step into a press
   * that is not its own — every handler below checks it before touching
   * `press`. This is a betting surface, and a resting thumb silently
   * stealing or corrupting the bet a pointing finger is naming is the thing
   * that must never happen. A second touch can therefore end a press, as the
   * start of a pinch, but it can never inherit one.
   */
  const [press, setPress] = useState<{
    pointerId: number;
    spotId: string | null;
    held: boolean;
  } | null>(null);
  /* Hover, which is a desk's way of asking the same question and costs nothing. */
  const [hovered, setHovered] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * The fingers on the cloth, and what they have turned out to be doing.
   *
   * Only touches are counted. A mouse has one pointer and a desk has the room
   * to draw the whole board at a size worth aiming at, so nothing here changes
   * what a mouse does — which is also why the rule about a second pointer
   * below only ever fires on a phone.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const doing = useRef<"pan" | "pinch" | null>(null);
  /** Where a pan or a pinch started, and the view it started from. */
  const grip = useRef<{ x: number; y: number; span: number; from: View } | null>(null);

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
   * Which way round the cloth goes, decided from the width of the room.
   *
   * The room's width rather than the viewport's, because this is a question
   * about the space it was given and not about the device: the same cloth is
   * narrow beside a wheel on a desk and wide on a tablet held sideways. Below
   * the threshold a landscape cloth gives squares around twenty-four pixels,
   * which is under a thumb and under legibility both.
   *
   * And the room's rather than the cloth's own, which is what this used to
   * measure. A turned cloth is five squares across where a laid-out one is
   * fourteen, so it is narrow by construction — a cloth that measures itself
   * hands its own answer back as the question and can never come back from
   * being turned. One narrow moment and it was portrait for the rest of the
   * session, on a 1440px desk included. The room does not change size when
   * the cloth inside it turns.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const room = frame.current;
    if (room === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) {
        setNarrow(width < TURNS_AT);
      }
    });
    watch.observe(room);
    return () => watch.disconnect();
  }, []);

  const sideways = portrait ?? narrow;

  /*
   * Where the cloth has been pushed to, and how far in.
   *
   * A ref rather than state because a drag writes to it on every frame and a
   * cloth is two hundred elements: re-rendering all of them to move one
   * transform is how a drag on a phone comes out at fifteen frames a second.
   * The transform is written straight onto `roam`, which is exactly why that
   * element exists and why React never gives it a style of its own.
   *
   * The two things a render does need — whether there is anywhere left to
   * roam to, and whether the last move should travel — are the two pieces of
   * state below, and they change at the ends of a gesture rather than during
   * one.
   */
  const view = useRef<View>(FIT);
  const [roaming, setRoaming] = useState(false);
  const [easing, setEasing] = useState(false);

  /**
   * Puts the view on the cloth, bounded.
   *
   * The bound is "felt never leaves the frame": at the whole-board zoom the
   * cloth does not move at all, and past it the offsets are held inside the
   * distance the cloth has grown by. A board that can be flung off its own
   * table is a board somebody has to find again with a closing window on
   * them.
   */
  const settle = useCallback((next: View, travel = false) => {
    const box = roam.current;
    if (box === null) {
      return;
    }
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const k = Math.min(MOST_ZOOM, Math.max(1, next.k));
    const held: View = {
      k,
      x: Math.min(0, Math.max(width - width * k, next.x)),
      y: Math.min(0, Math.max(height - height * k, next.y)),
    };
    view.current = held;
    box.style.transform =
      held.k === 1 && held.x === 0 && held.y === 0
        ? ""
        : `translate(${held.x}px, ${held.y}px) scale(${held.k})`;
    setEasing(travel);
    setRoaming(held.k > 1.001);
  }, []);

  /** Back to the whole board, which is where every round starts. */
  const toFit = useCallback(() => settle(FIT, true), [settle]);

  /*
   * A cloth that turned, or a room that changed size, is a different board:
   * the offsets it was pushed to name somewhere that no longer exists.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the turn is the trigger, not a value read
  useEffect(() => {
    settle(FIT);
  }, [sideways, settle]);

  /**
   * Zooms about a point, keeping whatever is under it under it.
   *
   * `roam` is scaled from its own top-left corner, so that corner stays put
   * however far in the pinch goes — which is what lets the untransformed
   * origin be recovered from the rectangle rather than measured separately.
   */
  const nipTo = useCallback(
    (k: number, atX: number, atY: number) => {
      const box = roam.current;
      if (box === null) {
        return;
      }
      const rect = box.getBoundingClientRect();
      const { k: was, x, y } = view.current;
      // Where the fingers are on the cloth itself, in its own untransformed px.
      const acrossCloth = (atX - (rect.left - x) - x) / was;
      const downCloth = (atY - (rect.top - y) - y) / was;
      const to = Math.min(MOST_ZOOM, Math.max(1, k));
      settle({ k: to, x: x + acrossCloth * (was - to), y: y + downCloth * (was - to) });
    },
    [settle],
  );

  /**
   * Turns a pointer somewhere on the cloth into the spot it is aimed at.
   *
   * Takes the two numbers it actually needs rather than a particular kind of
   * event, because the same question is asked of a pointer press and of a
   * context menu, and those arrive as different event types.
   *
   * A pan and a zoom cost this nothing: the rectangle a browser reports for a
   * transformed element is the one you can see, so the fraction this works in
   * is already the right fraction.
   */
  const spotUnder = (event: { clientX: number; clientY: number }): string | null => {
    const cloth = felt.current;
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

  /*
   * Reported from an effect rather than during render, so a parent's setter
   * is never called while React is still deciding what this render looks
   * like — that is the render loop an earlier task in this plan lost time
   * chasing. The caller must pass a stable handler (a useState setter, not an
   * inline arrow) or this fires every render regardless.
   */
  useEffect(() => {
    onAim?.(aimed?.kind ?? null);
  }, [aimed, onAim]);

  /** Two fingers apart, for a pinch. */
  const spanOf = (): { span: number; x: number; y: number } => {
    const [one, two] = [...touches.current.values()];
    if (one === undefined || two === undefined) {
      return { span: 0, x: 0, y: 0 };
    }
    return {
      span: Math.hypot(one.x - two.x, one.y - two.y),
      x: (one.x + two.x) / 2,
      y: (one.y + two.y) / 2,
    };
  };

  /** The end of a gesture, whichever way the finger left. */
  const lift = (event: { pointerId: number }) => {
    touches.current.delete(event.pointerId);
    /*
     * A pinch is over when the last of its fingers goes, not when the first
     * does. Otherwise lifting one of two hands a live press to the finger
     * still down, and the bet it places is one nobody aimed.
     */
    if (touches.current.size === 0) {
      doing.current = null;
      grip.current = null;
    }
  };

  return (
    /*
     * The room. It does not move, it clips whatever is pushed about inside
     * it, and its width is the one measurement that does not change when the
     * cloth turns — which is what the orientation is decided from.
     *
     * A group rather than a plain box, because it is one control with many
     * targets: the lines and the four-way points a chip can sit on are not
     * elements and cannot be, so the surface answers for all of them. The
     * name is on the room rather than on the cloth inside it because the room
     * is what a finger actually presses — including the strip of nothing
     * either side of a cloth the bound has stopped from growing, where a
     * press means no bet and a drag still moves the board.
     *
     * Aiming is a pointer's talent and nothing else's, which is why the real
     * keyboard route is the list of buttons at the end of this component
     * rather than anything bolted onto this div. Placing a bet is not
     * something a person should need a mouse for.
     */
    <div
      className={`rl__cloth-box${sideways ? " rl__cloth-box--portrait" : ""}`}
      role="group"
      aria-label="The betting cloth"
      ref={frame}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (touches.current.size === 2) {
            /*
             * A second finger takes the cloth for a pinch and gives the press
             * up. It used to be ignored outright, for a good reason that has
             * not gone away — a resting thumb must never quietly become the
             * bet a pointing finger was naming — and this keeps the reason
             * while allowing the gesture: the second finger cannot take a
             * press over, only end it. Nothing is placed by arriving.
             */
            doing.current = "pinch";
            const { span, x, y } = spanOf();
            grip.current = { x, y, span, from: view.current };
            endPress();
            return;
          }
          if (touches.current.size > 2) {
            return;
          }
          /*
           * Where a drag would start from, recorded before anything that can
           * turn this press away. A shut cloth still has to be draggable:
           * the winning square is lit on it while the payouts land, and a
           * board you cannot move is a board whose lit square may be off
           * screen at exactly the moment it matters.
           */
          grip.current = { x: event.clientX, y: event.clientY, span: 0, from: view.current };
        }
        /*
         * Only the primary button aims. A right-click is on its way to a
         * context menu, and without this it puts a chip down on the way to
         * taking one off — the pile never shrinks.
         */
        if (disabled || event.button !== 0) {
          return;
        }
        // A press already owns the cloth: see the comment on `press` for why
        // a second finger never takes one over.
        if (press !== null) {
          return;
        }
        /*
         * Capture, so a finger that slides off an element inside the cloth
         * keeps reporting to the cloth. The opposite of Plinko's drop key,
         * which refuses capture because sliding off is its escape — here
         * sliding is how you aim, and lifting outside is the escape.
         *
         * A courtesy, and never a reason to drop the press: capture throws
         * for a pointer the browser no longer considers live, and an
         * exception here used to take the bet with it.
         */
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // A press that cannot be captured is still a press.
        }
        setPress({ pointerId: event.pointerId, spotId: spotUnder(event), held: false });
        holdTimer.current = setTimeout(() => {
          setPress((was) => (was === null ? null : { ...was, held: true }));
        }, HOLD_MS);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "touch" && touches.current.has(event.pointerId)) {
          touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        const held = grip.current;
        if (doing.current === "pinch" && held !== null && held.span > 0) {
          const { span, x, y } = spanOf();
          if (span > 0) {
            nipTo((held.from.k * span) / held.span, x, y);
          }
          return;
        }
        if (doing.current === "pan" && held !== null) {
          settle({
            k: view.current.k,
            x: held.from.x + (event.clientX - held.x),
            y: held.from.y + (event.clientY - held.y),
          });
          return;
        }

        /*
         * A touch that travels while there is board off screen is somebody
         * moving the board, not aiming at it — so the bet it was about to
         * place is given up, and so is the hold that would have taken one
         * back off.
         *
         * Only while there is somewhere to go. At the whole-board zoom a
         * drag would move nothing, and sliding to re-aim is worth more than
         * a gesture that does nothing: your own finger is over the square you
         * are choosing, and sliding is how you see past it.
         *
         * Before the press is consulted, because a shut cloth has no press
         * and still has to be draggable.
         */
        if (
          event.pointerType === "touch" &&
          touches.current.size === 1 &&
          view.current.k > 1.001 &&
          held !== null &&
          Math.hypot(event.clientX - held.x, event.clientY - held.y) > SLOP
        ) {
          doing.current = "pan";
          endPress();
          return;
        }

        if (press === null) {
          setHovered(spotUnder(event));
          return;
        }
        if (event.pointerId !== press.pointerId) {
          return;
        }

        const spot = spotUnder(event);
        setPress((was) => (was === null || was.spotId === spot ? was : { ...was, spotId: spot }));
      }}
      onPointerUp={(event) => {
        const moved = doing.current !== null;
        lift(event);
        if (press === null || event.pointerId !== press.pointerId) {
          return;
        }
        const { spotId, held } = press;
        endPress();
        // A drag or a pinch is not a bet, however it ends.
        if (moved) {
          return;
        }
        // The betting window can shut while a finger is still down — the
        // table's own clock, not this pointer, decides that. The aim and
        // ghost already vanish under `disabled` below; this is what stops
        // the lift itself from placing or taking back anything once shut.
        if (disabled) {
          return;
        }
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
      onPointerCancel={(event) => {
        lift(event);
        if (press !== null && event.pointerId === press.pointerId) {
          endPress();
        }
      }}
      onPointerLeave={() => setHovered(null)}
      onContextMenu={(event) => {
        // The browser's own menu is never what somebody wants over a chip.
        event.preventDefault();
        if (disabled || doing.current !== null) {
          return;
        }
        const spot = spotUnder(event);
        if (spot !== null) {
          onTake?.(spot);
        }
      }}
    >
      {/*
        The one element the pan and the zoom are written to, and it carries
        nothing else. React is never given a style for it, so a transform set
        on it forty times a second cannot be thrown away by a render that
        happened to land mid-drag.
      */}
      <div className={`rl__roam${easing ? " rl__roam--easing" : ""}`} ref={roam}>
        <div
          className={`rl__cloth${sideways ? " rl__cloth--portrait" : ""}${
            disabled ? " rl__cloth--shut" : ""
          }`}
          ref={felt}
          style={{ aspectRatio: sideways ? `${HEIGHT} / ${WIDTH}` : `${WIDTH} / ${HEIGHT}` }}
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
                  /*
                   * Tabbing onto a bet puts the whole board back.
                   *
                   * A focused one of these is drawn in the middle of the
                   * cloth, and the middle of a cloth pushed two thirds of the
                   * way off its frame is nowhere. Rather than chase the
                   * focused spot around with the view, the map is simply put
                   * away: pinching is a finger's way of working and tabbing
                   * is not, and a keyboard player wants to see the board they
                   * are betting on rather than the corner of it somebody's
                   * thumb last left.
                   */
                  onFocus={toFit}
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
      </div>

      {/*
        The way back out, and the only control the map costs.

        It turns up once there is board off screen and not before, because a
        player looking at the whole thing has nothing to be lost from. Over
        the felt rather than beside it: it belongs to the board it undoes, and
        the corner it sits in is the one part of a roulette cloth with nothing
        printed on it.
      */}
      {roaming ? (
        <button type="button" className="rl__whole" onClick={toFit}>
          Whole board
        </button>
      ) : null}
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

