import type { SeatView, TableView } from "@backroom/game-poker";
import { Card, FaceDown } from "../blackjack/Cards.js";
import { ChipStack } from "../chips/ChipStack.js";
import { Avatar } from "../game/Avatar.js";
import { TurnRing } from "../game/TurnRing.js";
import { fmt, pointing, seatAt, TABLE_CHIPS } from "./Felt.js";
import type { Move } from "./useIntent.js";

export function Seat({
  seat,
  at,
  of,
  state,
  mine,
  won,
  said,
  pending,
  using,
  spotlit,
}: {
  seat: SeatView;
  at: number;
  of: number;
  state: TableView;
  mine: boolean;
  won: number | null;
  said: string | null;
  pending: { move: Move | null } | null;
  /** The cards in your own best hand, so yours can be pointed at. */
  using: Set<string>;
  /** Whether this seat is the one being announced at this moment. */
  spotlit: boolean;
}) {
  /*
   * A press shows here before the table has answered it, which is the whole of
   * the optimistic bargain: folding is this player's own decision, so the seat
   * can look folded the moment they say so.
   */
  const folded = seat.folded || pending?.move === "fold";
  const acting = state.toAct === seat.id && pending?.move == null;
  const look = won !== null ? "won" : folded ? "folded" : seat.allIn ? "allIn" : acting ? "acting" : "waiting";

  const mark =
    state.button === seat.id
      ? "D"
      : state.smallBlindId === seat.id
        ? "SB"
        : state.bigBlindId === seat.id
          ? "BB"
          : null;

  return (
    <div
      className={`pk__seat pk__seat--${look}${mine ? " pk__seat--you" : ""}${
        seat.connected ? "" : " pk__seat--away"
      }${spotlit ? " pk__seat--spotlit" : ""}`}
      style={seatAt(at, of)}
    >
      <div className="pk__cards">
        {seat.hole.length === 0 || folded ? null : (
          seat.hole.map((one, index) =>
            one === null ? (
              // Not ours to see. A face-down card is the truth, and stays the
              // truth right up until they turn it over.
              // biome-ignore lint/suspicious/noArrayIndexKey: a hole has two places, not two cards
              <FaceDown key={index} deal={index} />
            ) : (
              <span
                key={`${one.rank}${one.suit}`}
                className={pointing(using, one)}
              >
                <Card card={one} deal={index} />
              </span>
            ),
          )
        )}
      </div>
      <div className="pk__who">
        <div className="pk__wholine">
          {/* Who you are actually playing, which a name alone does not say at a
              table of ten. Their own colour rings it, the same one it is
              everywhere else in the building. */}
          <Avatar
            name={seat.name}
            avatar={seat.avatar}
            accentColor={seat.accentColor}
            className="pk__face"
          />
          {/*
            * The clock goes round the face, which is the round thing on a seat
            * and the one that means "who". Around the whole seat it was an
            * ellipse stretched over a column of cards, drawn straight across
            * the hand it was waiting on.
            */}
          {acting ? <TurnRing endsAt={state.turnEndsAt} turnMs={state.turnMs} /> : null}
          <span className="pk__name">
            {seat.name}
            {seat.isBot ? <span className="pk__bot-mark">bot</span> : null}
          </span>
        </div>
        <span className="pk__stack">
          {/*
            * What they have left, as weight rather than only as a figure. Off
            * on a narrow felt, where the seat has no room to spare and the
            * number says it on its own.
            */}
          {seat.stack > 0 ? (
            <span className="pk__pile">
              <ChipStack amount={seat.stack} width={11} ladder={TABLE_CHIPS} most={9} tallest={3} />
            </span>
          ) : null}
          {fmt(seat.stack)}
        </span>
        {seat.committed > 0 ? <span className="pk__wager">bet {fmt(seat.committed)}</span> : null}
      </div>
      {mark === null ? null : (
        <span className={`pk__mark pk__mark--${mark.toLowerCase()}`}>{mark}</span>
      )}
      {said !== null ? <span className="pk__says">{said}</span> : null}
      {/*
        * What they just did, over their head and gone again.
        *
        * Keyed on the moment rather than the words, so two checks in a row are
        * two bubbles rather than one that never moves — React replaces the
        * element and the animation runs again.
        */}
      {seat.spoke != null ? (
        <span className="pk__bubble" key={seat.spoke.at}>
          {seat.spoke.said}
        </span>
      ) : null}
      {said === null && won !== null ? (
        <span className="pk__says">won {fmt(won)}</span>
      ) : null}

    </div>
  );
}
