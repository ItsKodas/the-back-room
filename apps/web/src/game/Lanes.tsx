import type { RoomView } from "@backroom/shared";
import type { CSSProperties } from "react";
import { ChipMark } from "../chips/Chip.js";
import { SeatAvatar } from "./Avatar.js";

const fmt = (n: number) => n.toLocaleString("en-US");

interface LanesProps {
  room: RoomView;
  seatId: string;
  /**
   * What the player rolling would stand on if they banked now, or null when
   * banking would not move them — nothing valid picked up, or not enough to
   * get on the board.
   */
  projected: number | null;
}

/**
 * The scores as a race.
 *
 * A column of numbers says who is ahead; a lane says by how much and how far
 * there is still to go, which is the question a player is actually asking
 * before deciding whether to roll again.
 */
export function Lanes({ room, seatId, projected }: LanesProps) {
  const target = room.ruleset.targetScore;
  const over = room.status === "over";
  const along = (score: number) => ({ "--p": `${Math.min(100, (score / target) * 100)}%` }) as CSSProperties;

  return (
    <div className="lanes">
      {room.buyIn > 0 || room.watching > 0 ? (
        <p className="lanes__meta">
          {room.watching > 0 ? <span>{room.watching} watching</span> : null}
          {room.buyIn > 0 ? (
            <span className="lanes__pot">
              Pot <ChipMark size={12} />
              {fmt(room.pot)}
            </span>
          ) : null}
        </p>
      ) : null}
      <ol className="lanes__list" aria-label={`Scores, first to ${fmt(target)}`}>
        {room.seats.map((seat) => {
          const turn = !over && seat.id === room.turn?.seatId;
          const won = over && room.winnerIds.includes(seat.id);
          // Said plainly, because otherwise a seat that never gets a turn looks
          // like the game has forgotten about them.
          const state = seat.waiting
            ? "in the next game"
            : won
              ? "won"
              : turn
                ? "rolling"
                : !seat.connected
                  ? "gone"
                  : seat.onBoard
                    ? null
                    : "not on yet";
          const classes = [
            "lane",
            turn ? "lane--turn" : "",
            won ? "lane--won" : "",
            seat.id === seatId ? "lane--you" : "",
            seat.waiting || !seat.connected ? "lane--away" : "",
          ]
            .filter((name) => name.length > 0)
            .join(" ");

          return (
            <li key={seat.id} className={classes}>
              <span className="lane__name">
                {seat.name}
                {seat.id === seatId ? " (you)" : ""}
                {state !== null ? <span className="lane__state">{state}</span> : null}
              </span>
              <span className="lane__track" aria-hidden="true">
                {room.ruleset.entryThreshold > 0 ? (
                  <span className="lane__entry" style={along(room.ruleset.entryThreshold)} />
                ) : null}
                {turn && projected !== null ? (
                  <span className="lane__ghost" style={along(projected)} />
                ) : null}
                <span className="lane__marker" style={along(seat.score)}>
                  <SeatAvatar seat={seat} />
                </span>
              </span>
              <span className="lane__score">{seat.waiting ? "—" : fmt(seat.score)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
