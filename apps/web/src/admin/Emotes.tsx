import { useCallback, useEffect, useRef, useState } from "react";
import { adminGet, adminPost, fmt } from "./api.js";

/**
 * The emote desk.
 *
 * Behind the same allowlist as minting a code, and for a reason that is not
 * about chips: this is the one place in the building where a file one person
 * chooses is handed to every other person's browser. Everything below is a
 * convenience — the server sniffs the bytes and refuses on its own, and it is
 * the server's refusal that is the rule.
 */

/** Kept in step with `packages/economy/src/emotes.ts`, which enforces them. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_SOUND_BYTES = 1024 * 1024;
const MAX_NAME = 24;

/** What the file pickers offer. SVG is deliberately not among them. */
const IMAGE_TYPES = "image/gif,image/png,image/jpeg,image/webp";
const SOUND_TYPES = "audio/mpeg,audio/ogg,audio/wav";

interface Emote {
  id: string;
  name: string;
  cost: number;
  imageMime: string;
  soundMime: string | null;
  imageBytes: number;
  soundBytes: number | null;
  createdAt: number;
  retired: boolean;
}

/** Kilobytes, which is the unit these files are actually in. */
const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))}KB`;

/**
 * A file as base64, without the data-URL preamble.
 *
 * FileReader rather than a hand-rolled loop over the bytes: btoa on a large
 * array has to be chunked to avoid blowing the argument limit, and this is the
 * browser doing the same job correctly.
 */
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read that file"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? "" : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function Emotes() {
  const [emotes, setEmotes] = useState<Emote[] | null>(null);
  // A read that failed and a read that has not landed yet both leave
  // `emotes` null, so this is what tells them apart: without it, a broken
  // list and an empty one both say "None yet.", which is a lie the first way.
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("250");
  const [image, setImage] = useState<File | null>(null);
  const [sound, setSound] = useState<File | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const soundInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    void adminGet<{ emotes: Emote[] }>("/api/admin/emotes").then((body) => {
      setFailed(body === null);
      setEmotes(body === null ? null : body.emotes);
    });
  }, []);

  useEffect(load, [load]);

  const clear = () => {
    setName("");
    setImage(null);
    setSound(null);
    // The inputs are uncontrolled, so the files they are showing have to be
    // cleared by hand or the form still names a file it is no longer sending.
    if (imageInput.current !== null) {
      imageInput.current.value = "";
    }
    if (soundInput.current !== null) {
      soundInput.current.value = "";
    }
  };

  const add = () => {
    const chips = Number(cost);
    if (image === null) {
      setSaid("Pick a picture.");
      return;
    }
    if (name.trim().length === 0) {
      setSaid("Give it a name.");
      return;
    }
    if (!Number.isFinite(chips) || chips < 0) {
      setSaid("A cost is a whole number of chips.");
      return;
    }
    /*
     * Checked here as well so somebody does not sit through the upload of a
     * file that was always going to be refused. The server checks it too, and
     * that is the check that counts.
     */
    if (image.size > MAX_IMAGE_BYTES) {
      setSaid("That picture is over 2MB.");
      return;
    }
    if (sound !== null && sound.size > MAX_SOUND_BYTES) {
      setSaid("That sound is over 1MB.");
      return;
    }

    setBusy(true);
    setSaid(null);
    void (async () => {
      try {
        const body = {
          name: name.trim(),
          cost: Math.floor(chips),
          image: await base64(image),
          // A sound is optional, and absent is how that is said.
          ...(sound === null ? {} : { sound: await base64(sound) }),
        };
        const answer = await adminPost<{ emote?: Emote }>("/api/admin/emotes", body);
        if (!answer.ok) {
          setSaid(answer.error);
          return;
        }
        setSaid(`Added ${answer.body.emote?.name ?? "it"}.`);
        clear();
        load();
      } catch {
        setSaid("Could not read that file.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <section className="housing" aria-labelledby="emotes-new">
        <div className="housing__head">
          <h2 className="label" id="emotes-new">
            New emote
          </h2>
        </div>
        <div className="housing__body">
          <div className="desk__two">
            <label className="entry">
              <span className="label">Name</span>
              <input
                className="input"
                value={name}
                maxLength={MAX_NAME}
                placeholder="Smug"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="entry">
              <span className="label">What a throw costs</span>
              <input
                className="input"
                value={cost}
                inputMode="numeric"
                onChange={(event) => setCost(event.target.value)}
              />
            </label>
            <label className="entry">
              <span className="label">Picture — GIF, PNG, JPEG or WebP, up to 2MB</span>
              <input
                className="input"
                type="file"
                ref={imageInput}
                accept={IMAGE_TYPES}
                onChange={(event) => setImage(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="entry">
              <span className="label">Sound — optional, MP3, OGG or WAV, up to 1MB</span>
              <input
                className="input"
                type="file"
                ref={soundInput}
                accept={SOUND_TYPES}
                onChange={(event) => setSound(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <button type="button" className="slab slab--wide" disabled={busy} onClick={add}>
            {busy ? "Uploading…" : "Add emote"}
          </button>
          <p className="panel__note">
            Players pay to throw these at each other. The chips are staked on whoever it lands
            on: if they win the hand they take the lot and it comes back at whoever threw it,
            and if they lose it is gone. A sound is optional — plenty of them are funnier
            without one.
          </p>
          {said === null ? null : (
            <p className="panel__note" role="status">
              {said}
            </p>
          )}
        </div>
      </section>

      <section className="housing" aria-labelledby="emotes-list">
        <div className="housing__head">
          <h2 className="label" id="emotes-list">
            Emotes
          </h2>
        </div>
        <div className="housing__body">
          {emotes === null || emotes.length === 0 ? (
            <p className="panel__note">{failed ? "Could not read the emotes." : "None yet."}</p>
          ) : (
            <div className="desk__emotes">
              {emotes.map((emote) => (
                <EmoteCard key={emote.id} emote={emote} onChanged={load} />
              ))}
            </div>
          )}
          <p className="panel__note">
            Retiring one stops it being offered and keeps its picture for any replay still owed.
            Deleting one removes it for good; a replay still owed shows its name without it.
          </p>
        </div>
      </section>
    </>
  );
}

/**
 * One emote, and the two ways to be rid of it.
 *
 * Delete arms on the first press and fires on the second, and disarms itself
 * after a moment — the same bargain as leaving a table, because it is the
 * one press here that cannot be undone.
 */
function EmoteCard({ emote, onChanged }: { emote: Emote; onChanged: () => void }) {
  const [arming, setArming] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    if (!arming) {
      return;
    }
    const timer = setTimeout(() => setArming(false), 3000);
    return () => clearTimeout(timer);
  }, [arming]);

  const post = (path: string) => {
    // Cleared at the start of every attempt, not just a successful one — the
    // card keeps its instance across a reload (same `key`), so a stale
    // refusal from an earlier press would otherwise sit there forever, long
    // after the thing it complained about no longer applies.
    setSaid(null);
    void adminPost(path, {}).then((answer) => {
      if (answer.ok) {
        onChanged();
      } else {
        // The server's own words: a 404 (already gone) and no connection at
        // all are different problems, and only the server knows which.
        setSaid(answer.error);
      }
    });
  };

  return (
    <article className={`desk__emote${emote.retired ? " desk__emote--retired" : ""}`} aria-label={emote.name}>
      <img className="desk__emote-art" src={`/api/emotes/${emote.id}/image`} alt="" />
      <div className="desk__emote-text">
        <strong>{emote.name}</strong>
        <span className="panel__note">
          <span className="code__chips">{fmt(emote.cost)}</span> · {emote.soundMime === null ? "no sound" : "sound"} ·{" "}
          {size(emote.imageBytes + (emote.soundBytes ?? 0))}
          {emote.retired ? " · retired" : ""}
        </span>
      </div>
      <div className="desk__buttons">
        {emote.retired ? null : (
          <button
            type="button"
            className="key key--small"
            onClick={() => post(`/api/admin/emotes/${emote.id}/retire`)}
          >
            Retire
          </button>
        )}
        <button
          type="button"
          className={`key key--small${arming ? " key--danger" : ""}`}
          onClick={() => {
            if (arming) {
              post(`/api/admin/emotes/${emote.id}/delete`);
              return;
            }
            setArming(true);
          }}
        >
          {arming ? "Delete for good?" : "Delete"}
        </button>
      </div>
      {said === null ? null : (
        <p className="desk__emote-said desk__bad" role="status">
          {said}
        </p>
      )}
    </article>
  );
}
