import { useCallback, useEffect, useState } from "react";

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
  profile?: AccountProfile;
}

/** The signed-in profile, or nothing at all — guests play without one. */
export function useAccount(): Account {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const response = await fetch("/api/me", { credentials: "include" });
        if (!response.ok) {
          setProfile(null);
          return;
        }
        const body = (await response.json()) as MeResponse;
        setAvailable(body.signinAvailable);
        setProfile(body.signedIn ? (body.profile ?? null) : null);
      } catch {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(refresh, [refresh]);

  const setChips = useCallback((chips: number) => {
    setProfile((current) => (current === null ? current : { ...current, chips }));
  }, []);

  const signOut = useCallback(() => {
    void (async () => {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
      setProfile(null);
    })();
  }, []);

  return {
    profile,
    available,
    loading,
    refresh,
    setChips,
    signOut,
  };
}
