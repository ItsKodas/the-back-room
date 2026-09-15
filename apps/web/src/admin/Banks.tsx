import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, fmt } from "./api.js";

/**
 * The games that keep a bank, and what each calls the thing it deals.
 *
 * Every bank the economy keeps has to be here, and the wheel's was missing for
 * a while: the store held it, the route served it and the felt asked it for
 * headroom — there was simply no panel to put the first chips in, and a bank
 * at zero refuses every bet on the cloth. `Admin.test.tsx` holds this list
 * against the economy's own now.
 *
 * The wording stays here rather than being read off that list, because it is
 * the wording that has to be the game's own: a machine takes a stake on a
 * spin, a felt on a hand, and a wheel's cap is what one chip may sit on a
 * single number for.
 */
export const BANKS = [
  { game: "slots", label: "Slots", per: "a spin" },
  { game: "blackjack", label: "Blackjack", per: "a hand" },
  { game: "roulette", label: "Roulette", per: "straight up" },
  { game: "two-up", label: "Two-up", per: "a five-odds chip" },
] as const;

interface Held {
  bank: number;
  maxStake: number;
}

export function Banks() {
  return (
    <>
      <p className="desk__lede">
        Players fill each bank from then on, chip for chip, and every win comes back out of it.
        A float is the only other way in. Each game keeps its own — a shared one would be
        whichever game keeps the most quietly paying for the one that keeps the least.
      </p>
      <div className="desk__grid">
        {BANKS.map((bank) => (
          <Bank key={bank.game} game={bank.game} label={bank.label} per={bank.per} />
        ))}
      </div>
    </>
  );
}

function Bank({ game, label, per }: { game: string; label: string; per: string }) {
  const [held, setHeld] = useState<Held | null>(null);
  const [amount, setAmount] = useState("50000");
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    void adminGet<Held>(`/api/admin/bank?game=${game}`).then(setHeld);
  }, [game]);

  useEffect(load, [load]);

  const float = () => {
    const chips = Number(amount);
    if (!Number.isFinite(chips) || chips < 1) {
      setSaid("Give it an amount.");
      return;
    }
    void adminPost<Held>("/api/admin/bank", { amount: Math.floor(chips), game }).then((answer) => {
      if (!answer.ok) {
        setSaid(answer.error);
        return;
      }
      setHeld(answer.body);
      setSaid(`Added ${fmt(Math.floor(chips))}.`);
    });
  };

  const id = `bank-${label.toLowerCase().replace(/\W+/g, "-")}`;

  return (
    <section className="housing desk__card" aria-labelledby={id}>
      <div className="housing__head">
        <h2 className="label" id={id}>
          {label}
        </h2>
      </div>
      <div className="housing__body">
        {held === null ? (
          <p className="panel__note">Could not read it.</p>
        ) : (
          <>
            <div className="readout">
              <strong className="readout__figure readout__figure--chips">{fmt(held.bank)}</strong>
            </div>
            <p className="panel__note">
              {held.maxStake < 1
                ? `Empty, so ${label.toLowerCase()} will not take a stake at all.`
                : `Covers ${fmt(held.maxStake)} ${per}.`}
            </p>
          </>
        )}
        <form
          className="desk__inline"
          onSubmit={(event) => {
            event.preventDefault();
            float();
          }}
        >
          <input
            className="input"
            aria-label={`Float for ${label}`}
            value={amount}
            inputMode="numeric"
            onChange={(event) => setAmount(event.target.value)}
          />
          <button type="submit" className="slab slab--small">
            Float
          </button>
        </form>
        {said === null ? null : (
          <p className="panel__note" role="status">
            {said}
          </p>
        )}
      </div>
    </section>
  );
}
