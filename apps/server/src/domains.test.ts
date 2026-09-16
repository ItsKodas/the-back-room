import { describe, expect, it } from "vitest";
import { canonicalRedirect, friendlyRedirect } from "./domains.js";

const GAMES = ["greed", "blackjack", "slots"];
const HOME = "https://casino.horizons.gg";

describe("a game's own subdomain", () => {
  it("sends the bare subdomain to that game", () => {
    expect(friendlyRedirect("greed.horizons.gg", "/", GAMES, HOME)).toBe(
      "https://casino.horizons.gg/greed",
    );
    expect(friendlyRedirect("blackjack.horizons.gg", "/", GAMES, HOME)).toBe(
      "https://casino.horizons.gg/blackjack",
    );
  });

  it("keeps the path when there already is one", () => {
    // A shared table code, which resolves to its own game once it lands.
    expect(friendlyRedirect("greed.horizons.gg", "/X7KQ3", GAMES, HOME)).toBe(
      "https://casino.horizons.gg/X7KQ3",
    );
    expect(friendlyRedirect("greed.horizons.gg", "/me", GAMES, HOME)).toBe(
      "https://casino.horizons.gg/me",
    );
  });

  it("leaves every other host alone", () => {
    expect(friendlyRedirect("casino.horizons.gg", "/", GAMES, HOME)).toBeNull();
    expect(friendlyRedirect("localhost", "/", GAMES, HOME)).toBeNull();
    expect(friendlyRedirect("poker.horizons.gg", "/", GAMES, HOME)).toBeNull();
  });

  it("never moves what the browser asks for on its own behalf", () => {
    // Redirecting these would break the socket handshake and the sign-in
    // round-trip for anybody who reached the subdomain before the redirect.
    for (const path of ["/api/me", "/auth/discord", "/socket.io/", "/healthz"]) {
      expect(friendlyRedirect("greed.horizons.gg", path, GAMES, HOME)).toBeNull();
    }
    // But a path that merely starts with those letters is a client route.
    expect(friendlyRedirect("greed.horizons.gg", "/apiary", GAMES, HOME)).toBe(
      "https://casino.horizons.gg/apiary",
    );
  });

  it("refuses to send a host to itself", () => {
    // Otherwise CLIENT_ORIGIN pointed at the subdomain is an endless loop
    // rather than a misconfiguration somebody can see and fix.
    expect(friendlyRedirect("greed.horizons.gg", "/", GAMES, "https://greed.horizons.gg")).toBeNull();
    expect(friendlyRedirect("GREED.horizons.gg", "/", GAMES, "https://greed.horizons.gg")).toBeNull();
  });

  it("does nothing without a canonical origin to send anybody to", () => {
    expect(friendlyRedirect("greed.horizons.gg", "/", GAMES, "")).toBeNull();
    expect(friendlyRedirect("greed.horizons.gg", "/", GAMES, "not a url")).toBeNull();
  });
});

describe("the www twin of the canonical host", () => {
  it("sends www to the bare host, keeping the path and the query", () => {
    expect(canonicalRedirect("www.casino.horizons.gg", "/blackjack?x=1", HOME)).toBe(
      "https://casino.horizons.gg/blackjack?x=1",
    );
    expect(canonicalRedirect("WWW.casino.horizons.gg", "/", HOME)).toBe("https://casino.horizons.gg/");
  });

  it("sends the bare host to www when www is the canonical one", () => {
    expect(canonicalRedirect("horizons.gg", "/", "https://www.horizons.gg")).toBe(
      "https://www.horizons.gg/",
    );
  });

  it("leaves the canonical host, and every other host, alone", () => {
    expect(canonicalRedirect("casino.horizons.gg", "/", HOME)).toBeNull();
    expect(canonicalRedirect("localhost", "/", "http://localhost:3001")).toBeNull();
    expect(canonicalRedirect("www.example.com", "/", HOME)).toBeNull();
    expect(canonicalRedirect("www.casino.horizons.gg", "/", "not a url")).toBeNull();
  });

  it("never moves what the browser asks for on its own behalf", () => {
    for (const path of ["/api/me", "/auth/discord/callback?code=1", "/socket.io/?EIO=4", "/healthz"]) {
      expect(canonicalRedirect("www.casino.horizons.gg", path, HOME), path).toBeNull();
    }
  });
});

describe("a path that looks like somewhere else", () => {
  /*
   * A request line can carry `//evil.example/x`, and resolved as a URL against
   * the canonical origin that is a different host entirely. The redirect has to
   * land on the canonical host whatever the path says.
   */
  const SNEAKY = ["//evil.example/x", "/\\evil.example/x", "//evil.example"];

  it("never sends the www twin anywhere but the canonical host", () => {
    for (const path of SNEAKY) {
      const target = canonicalRedirect("www.casino.horizons.gg", path, HOME);
      expect(target === null || new URL(target).host === "casino.horizons.gg", path).toBe(true);
    }
  });

  it("never sends a game's subdomain anywhere but the canonical host", () => {
    for (const path of SNEAKY) {
      const target = friendlyRedirect("greed.horizons.gg", path, GAMES, HOME);
      expect(target === null || new URL(target).host === "casino.horizons.gg", path).toBe(true);
    }
  });
});
