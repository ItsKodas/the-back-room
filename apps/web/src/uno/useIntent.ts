import type { Card, Color, TableView } from "@backroom/game-uno";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What this player has asked for and not yet been told about.
 *
 * Every move is a round trip, so a press changes the felt at once and the
 * table's answer replaces it. The line is the building's: never invent a fact.
 *
 * A card you play is yours — you can see its face — so it leaves your hand and
 * lands on the pile on the press, in the colour you picked. A card you draw is
 * not yours to know yet, so what arrives is a card face down, and it turns
 * over when the table says what it is. Everything else — a ready, a call of
 * UNO, a challenge — holds its own key down and shows nothing it does not know.
 */

/** How long an unanswered press is trusted before the table's word wins. */
export const PATIENCE_MS = 3_000;

export interface Played {
  card: Card;
  color: Color | null;
}

export type Press = "draw" | "pass" | "uno" | "catch" | "challenge" | "accept" | "color" | null;

export interface Intent {
  /** A card on its way to the pile, shown there and gone from the hand. */
  played: Played | null;
  /**
   * A draw on its way: a face-down card arriving in the hand, for as long as
   * the hand is no bigger than it was when the key went down. The hand the
   * table sends growing is the card turning over.
   */
  drawing: number | null;
  /** Which key is held down for a move with nothing to show early. */
  pressed: Press;
  ready: boolean | null;
  busy: boolean;
  play: (card: Card, color: Color | null) => void;
  /** `held`: how many cards are in the hand as the key goes down. */
  draw: (held: number) => void;
  press: (which: Exclude<Press, null>) => void;
  setReady: (ready: boolean) => void;
}

export function useIntent(view: TableView | null, error: string | null, errorKey = 0): Intent {
  const [played, setPlayed] = useState<Played | null>(null);
  const [drawing, setDrawing] = useState<number | null>(null);
  const [pressed, setPressed] = useState<Press>(null);
  const [ready, setReadyState] = useState<boolean | null>(null);
  const tokens = useRef({ move: 0, ready: 0 });
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) {
        window.clearTimeout(id);
      }
    };
  }, []);

  /** Gives up on a press that was never answered — but only that press. */
  const patience = useCallback((of: "move" | "ready", token: number, drop: () => void) => {
    timers.current.push(
      window.setTimeout(() => {
        if (tokens.current[of] === token) {
          drop();
        }
      }, PATIENCE_MS),
    );
  }, []);

  const clearMove = useCallback(() => {
    setPlayed(null);
    setDrawing(null);
    setPressed(null);
  }, []);

  const play = useCallback(
    (card: Card, color: Color | null) => {
      const token = ++tokens.current.move;
      setPlayed({ card, color });
      setDrawing(null);
      setPressed(null);
      patience("move", token, clearMove);
    },
    [patience, clearMove],
  );

  const draw = useCallback((held: number) => {
    const token = ++tokens.current.move;
    setPlayed(null);
    setDrawing(held);
    setPressed("draw");
    patience("move", token, clearMove);
  }, [patience, clearMove]);

  const press = useCallback(
    (which: Exclude<Press, null>) => {
      const token = ++tokens.current.move;
      setPressed(which);
      patience("move", token, () => setPressed(null));
    },
    [patience],
  );

  const setReady = useCallback(
    (value: boolean) => {
      const token = ++tokens.current.ready;
      setReadyState(value);
      patience("ready", token, () => setReadyState(null));
    },
    [patience],
  );

  /*
   * The table caught up. A played card has landed once it is on top of the
   * pile or no longer in the hand the table sends; anything else has landed
   * once the table has said something new at all — the table moving is the
   * answer, whatever it was.
   */
  const seq = view?.eventSeq ?? 0;
  const lastSeq = useRef(seq);
  const handIds = view?.hand?.cards.map((card) => card.id).join(",") ?? "";
  useEffect(() => {
    if (played !== null && (view?.top?.id === played.card.id || !handIds.split(",").includes(String(played.card.id)))) {
      setPlayed(null);
    }
  }, [played, view?.top?.id, handIds]);

  useEffect(() => {
    if (seq !== lastSeq.current) {
      lastSeq.current = seq;
      setDrawing(null);
      setPressed(null);
    }
  }, [seq]);

  const mine = view?.you?.ready;
  useEffect(() => {
    if (ready !== null && mine === ready) {
      setReadyState(null);
    }
  }, [ready, mine]);

  // A refusal is the table's answer too, and everything shown early is given up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      clearMove();
      setReadyState(null);
    }
  }, [error, errorKey, clearMove]);

  return {
    played,
    drawing,
    pressed,
    ready,
    busy: played !== null || drawing !== null || pressed !== null,
    play,
    draw,
    press,
    setReady,
  };
}
