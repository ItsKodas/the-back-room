import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface AccountProfile {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  /** What every game can answer, whatever the game was. */
  stats: {
    rounds: number;
    roundsWon: number;
    chipsWon: number;
    chipsStaked: number;
  };
  /**
   * What one game can answer, under that game's own name. Untyped beyond
   * "numbers by name" on purpose: a game names its own figures and nothing
   * here knows what they mean.
   */
  byGame: Record<string, Record<string, number>>;
}

export interface Account {
  profile: AccountProfile | null;
  /** False when the server has no Discord credentials configured. */
  available: boolean;
  loading: boolean;
  /**
   * Whether to offer the way to the admin desk. A courtesy, not a key: the
   * desk's routes answer 404 to anybody the server does not have on its list.
   */
  admin: boolean;
  refresh: () => void;
  /**
   * Takes a balance the server has pushed, without asking for the profile
   * again. Everything else on the profile is unchanged, because nothing else
   * moved — this is the number going up and down during a hand.
   */
  setChips: (chips: number) => void;
  signOut: () => void;
}

interface MeResponse {
  signedIn: boolean;
  signinAvailable: boolean;
  admin?: boolean;
  profile?: AccountProfile;
}

const Shared = createContext<Account | null>(null);

/**
 * One account for the whole building.
 *
 * Every page used to ask for its own, so every link was a fresh "who are you"
 * with nothing to show until it was answered — and a balance set by one page
 * was not the balance the next page started from.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const account = useOwnAccount(true);
  return createElement(Shared.Provider, { value: account }, children);
}

/**
 * The signed-in profile, or nothing at all — guests play without one.
 *
 * The building's shared one when there is a provider above; otherwise its
 * own, so a page rendered on its own still knows who is playing.
 */
export function useAccount(): Account {
  const shared = useContext(Shared);
  const own = useOwnAccount(shared === null);
  return shared ?? own;
}

function useOwnAccount(enabled: boolean): Account {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const response = await fetch("/api/me", { credentials: "include" });
        if (!response.ok) {
          setProfile(null);
          setAdmin(false);
          return;
        }
        const body = (await response.json()) as MeResponse;
        setAvailable(body.signinAvailable);
        setProfile(body.signedIn ? (body.profile ?? null) : null);
        setAdmin(body.signedIn && body.admin === true);
      } catch {
        setProfile(null);
        setAdmin(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, refresh]);

  const setChips = useCallback((chips: number) => {
    setProfile((current) => (current === null ? current : { ...current, chips }));
  }, []);

  const signOut = useCallback(() => {
    void (async () => {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
      setProfile(null);
      setAdmin(false);
    })();
  }, []);

  // Stable between renders that changed nothing, since every page reads it.
  return useMemo(
    () => ({ profile, available, loading, admin, refresh, setChips, signOut }),
    [profile, available, loading, admin, refresh, setChips, signOut],
  );
}
