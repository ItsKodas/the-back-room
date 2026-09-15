import { RULESETS } from "@backroom/rules";
import { Navbar } from "../nav/Navbar.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import { Seg } from "../fittings/Seg.js";
import { SeatAvatar } from "./Avatar.js";
import "@backroom/game-greed/theme.css";
import type { ChatMessage, RoomView } from "@backroom/shared";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chat } from "./Chat.js";
import { HouseRulesEditor } from "./HouseRulesEditor.js";
import { Table } from "./Table.js";
import type { Account } from "./useAccount.js";
import { useAccount } from "./useAccount.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import type { RoomActions } from "./useRoom.js";
import { useRoom } from "./useRoom.js";
import { useSound } from "./useSound.js";

export function Play() {
  const params = useParams();
  const navigate = useNavigate();
  const raw = (params["code"] ?? "").toUpperCase();
  // Only something shaped like a table code gets treated as one; anything else
  // is just a wrong address.
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";
  const account = useAccount();
  // The balance in the corner follows the game: a stake leaves as it is
  // placed and the pot comes back the moment somebody wins it.
  const {
    room,
    listed,
    heldLocally,
    pendingRoll,
    chat,
    seatId,
    error,
    connected,
    taken,
    retry,
    busy,
    landed,
    stakes,
    actions,
  } = useRoom(account.setChips);
  useSound(room, seatId);

  /*
   * Which room you are standing in, on the document rather than on this
   * element — the page's own background lives on body, so a game that only
   * repainted its own subtree would sit in the building's colours with a
   * warm rectangle in the middle of it.
   *
   * Cleared on the way out, so the room picker and the profile are the
   * building's again.
   */
  useEffect(() => {
    document.documentElement.dataset["game"] = "greed";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  // The address bar follows the table, so a link can be shared and a refresh
  // lands back in the right place.
  useEffect(() => {
    if (room !== null && room.code !== urlCode) {
      navigate(`/greed/${room.code}`, { replace: true });
    }
  }, [room, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    <main className="play">
      <Navbar
        /* GRE-E-D, with the second E lit — the mark the game opened with. */
        game={
          <>
            GRE<em>E</em>D
          </>
        }
        {...(room !== null
          ? {
              table: {
                code: room.code,
                onLeave: actions.leave,
                confirm: room.status === "playing",
              },
            }
          : {})}
        account={account}
        connected={connected}
      />

      {error !== null ? <p className="play__error">{error}</p> : null}
      {room?.lastEvent != null && room.status !== "lobby" ? (
        <p className="play__event">{room.lastEvent}</p>
      ) : null}

      {taken !== null ? (
        <Taken message={taken} onRetry={retry} />
      ) : room === null ? (
        <Join
          actions={actions}
          busy={busy}
          connected={connected}
          invited={urlCode}
          account={account}
        />
      ) : room.status === "lobby" ? (
        <Lobby
          room={room}
          listed={listed}
          seatId={seatId}
          actions={actions}
          chat={chat}
          account={account}
        />
      ) : (
        <>
          <Table
            room={room}
            seatId={seatId ?? ""}
            actions={actions}
            heldLocally={heldLocally}
            pendingRoll={pendingRoll}
          />
          <div className="play__talk">
            <Chat log={chat} seatId={seatId} onSay={actions.say} />
            <TauntPicker
              seats={room.seats}
              seatId={seatId}
              chips={account.profile?.chips ?? null}
              stakes={stakes}
              onThrow={(emote, at) => {
                /*
                 * The cost comes off the corner on the press rather than when
                 * the server answers. It is the player's own number — they
                 * chose the emote and it has a price — so showing it at once
                 * invents nothing, and the ack corrects it either way.
                 */
                if (account.profile !== null) {
                  account.setChips(account.profile.chips - emote.cost);
                }
                actions.taunt(emote.id, at, (result) => {
                  if (result.ok) {
                    account.setChips(result.chips);
                  } else {
                    // Refused, so give the optimistic decrement back.
                    account.refresh();
                  }
                });
              }}
            />
          </div>
          {/* Over the felt rather than inside it: a taunt belongs to the table,
              not to the dice. */}
          <TauntStage landed={landed} />
        </>
      )}
    </main>
  );
}

/**
 * The stake. Only offered when everyone at the table is signed in and there
 * are no bots — a bot has no balance to lose and no account to pay, so letting
 * one into a pot would mint or destroy chips.
 */
function BuyIn({
  room,
  editable,
  signedIn,
  chips,
  onSet,
}: {
  room: RoomView;
  editable: boolean;
  signedIn: boolean;
  chips: number;
  onSet: (amount: number) => void;
}) {
  const bots = room.seats.some((seat) => seat.isBot);
  const guests = room.seats.some((seat) => !seat.signedIn);
  const blocked = bots || guests || !signedIn;

  return (
    <section className="housing" aria-label="Stake">
      <div className="housing__head">
        <h2 className="label">Stake</h2>
      </div>
      <div className="housing__body">
        {blocked ? (
          <p className="hint rules__chips">
            {bots
              ? "Bots play for free. Remove them to play for chips."
              : "Everyone has to be signed in to play for chips."}
          </p>
        ) : (
          <div className="lamps">
            {[0, 100, 500, 1000].map((amount) => (
              <button
                key={amount}
                type="button"
                role="radio"
                aria-checked={room.buyIn === amount}
                disabled={!editable || amount > chips}
                className="lamp lamp--chips"
                onClick={() => onSet(amount)}
              >
                {amount === 0 ? "for fun" : amount.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        )}
        {room.buyIn > 0 ? (
          <p className="hint rules__chips">
            Pot of {room.pot.toLocaleString("en-US")} — winner takes it.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Join({
  actions,
  busy,
  connected,
  invited,
  account,
}: {
  actions: RoomActions;
  busy: boolean;
  connected: boolean;
  /** A table code from the address bar, when someone followed a link. */
  invited: string;
  account: Account;
}) {
  const [typed, setTyped] = useState("");
  const [ruleset, setRuleset] = useState(RULESETS[0]?.name ?? "Farkle");

  // Someone signed in already has a name, and the server will seat them under
  // it whatever this sends — so asking for one would be a question with no
  // answer that counts. Hold the field back until we know which they are,
  // rather than showing it and snatching it away.
  const signedInName = account.profile?.name ?? null;
  const askName = !account.loading && signedInName === null;
  const name = signedInName ?? typed;
  const ready = !account.loading && name.trim().length > 0 && connected && !busy;

  if (invited.length > 0) {
    return (
      <div className="join">
        <p className="join__pitch">
          You have been invited to table <strong>{invited}</strong>.{" "}
          {askName ? "Put in a name and sit down." : "Take a seat."}
        </p>
        {askName ? (
          <label className="entry">
            <span className="label">Your name</span>
            <input
              className="input"
              value={typed}
              maxLength={20}
              placeholder="Ada"
              // biome-ignore lint/a11y/noAutofocus: this screen exists only to take a name after following an invitation
              autoFocus
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && ready) {
                  actions.join(name, invited);
                }
              }}
            />
          </label>
        ) : null}
        <div className="join__invited">
          <button
            type="button"
            className="slab"
            disabled={!ready}
            onClick={() => actions.join(name, invited)}
          >
            Take a seat
          </button>
        </div>
        {!connected ? <p className="join__warn">Waiting for the server…</p> : null}
      </div>
    );
  }

  return (
    <TableSetup
      game="greed"
      pitch="Roll six dice. Set aside what scores. Roll again for more, or bank it and pass the cup — but roll nothing scoring and you lose the lot."
      invited={invited}
      account={account}
      busy={busy}
      connected={connected}
      onJoin={actions.join}
      onWatch={actions.watch}
      options={
        <div className="plates" role="radiogroup" aria-label="Which dice">
          {RULESETS.map((option) => (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={option.name === ruleset}
              className="plate"
              onClick={() => setRuleset(option.name)}
            >
              <span className="plate__name">{option.name}</span>
              <span className="plate__note">
                {option.skin === "letters"
                  ? "$ G R E E D faces. First to 5,000."
                  : "Ordinary pips. First to 10,000."}
              </span>
            </button>
          ))}
        </div>
      }
      note={() => "You get a five-character code to share, or start alone to practise."}
      onCreate={(name, { maxSeats }) => actions.create(name, ruleset, maxSeats)}
    />
  );
}

/**
 * The table's code, and a one-press way to hand it to someone.
 *
 * The clipboard API only exists in a secure context, so over plain http on a
 * home network — which is exactly how someone invites the person next to them
 * — it is simply not there. Hence the older selection-based copy behind it,
 * and the readable link as a last resort: the code is the whole point of this
 * panel and must never be a dead end.
 */
function ShareCode({ code }: { code: string }) {
  const [said, setSaid] = useState<string | null>(null);
  const link = `${window.location.origin}/${code}`;

  const copy = () => {
    void (async () => {
      try {
        if (navigator.clipboard !== undefined) {
          await navigator.clipboard.writeText(link);
          setSaid("Link copied");
        } else if (legacyCopy(link)) {
          setSaid("Link copied");
        } else {
          setSaid("Copy it from the box above");
        }
      } catch {
        setSaid(legacyCopy(link) ? "Link copied" : "Copy it from the box above");
      }
      setTimeout(() => setSaid(null), 2500);
    })();
  };

  return (
    <section className="housing lobby__share" aria-labelledby="share-title">
      <div className="housing__head">
        <h2 className="label" id="share-title">
          Share this code
        </h2>
      </div>
      <div className="housing__body lobby__share-body">
        <div className="readout">
          <span className="lobby__code">{code}</span>
        </div>
        <input className="input lobby__link" value={link} readOnly aria-label="Link to this table" />
      </div>
      <div className="housing__foot">
        <button type="button" className="key key--wide" onClick={copy}>
          {said ?? "Copy link"}
        </button>
      </div>
    </section>
  );
}

/** Pre-clipboard-API copy, for the plain-http case. True when it took. */
function legacyCopy(text: string): boolean {
  try {
    const field = document.createElement("textarea");
    field.value = text;
    // Off-screen rather than hidden: a display:none field cannot be selected.
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Who can find this table.
 *
 * Public by default, because a table nobody can find is one you have to
 * arrange before you can play at — and the whole point of a room is walking
 * into it. The code still works either way; private only means the table is
 * not advertised.
 */
function Listing({
  listed,
  editable,
  onSet,
}: {
  listed: boolean;
  editable: boolean;
  onSet: (listed: boolean) => void;
}) {
  return (
    <section className="housing" aria-labelledby="listing-title">
      <div className="housing__head">
        <h2 className="label" id="listing-title">
          Who can find it
        </h2>
      </div>
      <div className="housing__body">
        <Seg
          label="Who can find this table"
          options={[
            { value: true, text: "Public" },
            { value: false, text: "Private" },
          ]}
          value={listed}
          onChange={onSet}
          disabled={!editable}
        />
        <p className="hint">
          {listed ? "Anyone can see this table and sit down." : "Only people you send the code to."}
        </p>
      </div>
    </section>
  );
}

function Lobby({
  room,
  listed,
  seatId,
  actions,
  chat,
  account,
}: {
  room: RoomView;
  listed: boolean;
  seatId: string | null;
  actions: RoomActions;
  chat: ChatMessage[];
  account: Account;
}) {
  const you = room.seats.find((seat) => seat.id === seatId);
  const solo = room.seats.length === 1;

  return (
    <div className="lobby">
      <ShareCode code={room.code} />

      <section className="housing lobby__seating" aria-labelledby="seating-title">
        <div className="housing__head">
          <h2 className="label" id="seating-title">
            Seated · {room.seats.length} of 8
            {room.watching > 0 ? ` · ${room.watching} watching` : ""}
          </h2>
        </div>
        <div className="housing__body">
          <div className="lobby__seats">
            {room.seats.map((seat) => (
              <div className="seat" key={seat.id}>
                <SeatAvatar seat={seat} />
                <div className="seat__who">
                  <div className="seat__name">
                    {seat.name}
                    {seat.id === seatId ? " (you)" : ""}
                  </div>
                  <div className="seat__state">
                    {seat.waiting
                      ? "In the next game"
                      : seat.isBot
                        ? "Bot"
                        : seat.isHost
                          ? "Host"
                          : "Ready"}
                  </div>
                </div>
                {you?.isHost === true && seat.id !== seatId ? (
                  <button
                    type="button"
                    className="seat__drop"
                    aria-label={`Remove ${seat.name}`}
                    onClick={() => actions.removeSeat(seat.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {you?.isHost === true ? (
            <>
              <div className="entry">
                <span className="label" id="add-bot-label">
                  Add an opponent
                </span>
                <div className="lamps" role="group" aria-labelledby="add-bot-label">
                  {(["easy", "normal", "hard"] as const).map((skill) => (
                    <button
                      key={skill}
                      type="button"
                      className="lamp lamp--word"
                      onClick={() => actions.addBot(skill)}
                    >
                      {skill}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="slab slab--wide" onClick={actions.start}>
                {solo ? "Practise on your own" : "Deal the first turn"}
              </button>
            </>
          ) : (
            <p className="panel__note">Waiting for the host to start.</p>
          )}
        </div>
      </section>

      <div className="lobby__wide">
        <div className="lobby__stack">
          <HouseRulesEditor
            room={room}
            editable={you?.isHost === true}
            onChange={actions.setRules}
          />
          <BuyIn
            room={room}
            editable={you?.isHost === true}
            signedIn={account.profile !== null}
            chips={account.profile?.chips ?? 0}
            onSet={actions.setBuyIn}
          />
          <Listing
            listed={listed}
            editable={you?.isHost === true}
            onSet={actions.setListed}
          />
        </div>
        <Chat log={chat} seatId={seatId} onSay={actions.say} />
      </div>
    </div>
  );
}
