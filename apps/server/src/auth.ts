import { Discord, generateCodeVerifier, generateState, OAuth2RequestError } from "arctic";
import type { Express, RequestHandler, Response as ExpressResponse } from "express";
import type { Store } from "@backroom/economy";
import { handle } from "./handle.js";

/**
 * Sign in with Discord.
 *
 * Deliberately optional: with no client credentials configured the routes
 * answer 503 and the rest of the game carries on, because guests can play
 * without an account. Signing in is what buys a persistent profile and chips.
 */

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Where to send the browser once it is done. */
  clientUrl: string;
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    oauthState?: string;
    /** Where to put somebody down once they are signed in. */
    returnTo?: string;
    oauthVerifier?: string;
  }
}

/**
 * Discord hands back an avatar hash, not a picture. Turning it into a URL here
 * rather than in the browser keeps the Discord account id off the wire, and
 * means everything downstream — the header, the seats — just has a `src`.
 *
 * Null for someone who never set a picture; they get their monogram instead,
 * which suits the table better than Discord's default blue circle.
 */
export function avatarUrl(user: { id: string; avatar?: string | null }): string | null {
  if (user.avatar === undefined || user.avatar === null || user.avatar.length === 0) {
    return null;
  }
  // An `a_` prefix marks an animated avatar, which is only animated as a gif.
  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig | null {
  const clientId = env["DISCORD_CLIENT_ID"];
  const clientSecret = env["DISCORD_CLIENT_SECRET"];
  if (
    clientId === undefined ||
    clientSecret === undefined ||
    clientId.length === 0 ||
    clientSecret.length === 0
  ) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: env["DISCORD_REDIRECT_URI"] ?? "http://localhost:3001/auth/discord/callback",
    clientUrl: env["CLIENT_ORIGIN"] ?? "http://localhost:5173",
  };
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  accent_color?: number | null;
}

/**
 * One way out when signing in cannot continue.
 *
 * Every one of these used to redirect in silence, which left an operator with
 * a failed page, an empty log and nothing to go on. The reason is written to
 * the log and put on the URL: it names which step gave up, and none of these
 * values tells an attacker anything they did not already know by causing it.
 */
function giveUp(
  response: ExpressResponse,
  config: AuthConfig,
  reason: string,
  detail?: Record<string, unknown>,
): void {
  console.error(`backroom: discord sign-in failed (${reason})`, detail ?? "");
  response.redirect(`${config.clientUrl}/?signin=failed&why=${reason}`);
}

export function mountAuth(app: Express, store: Store, config: AuthConfig | null): void {
  if (config === null) {
    const unavailable: RequestHandler = (_request, response) => {
      response
        .status(503)
        .json({ error: "Discord sign-in is not configured on this server." });
    };
    app.get("/auth/discord", unavailable);
    app.get("/auth/discord/callback", unavailable);
    return;
  }

  const discord = new Discord(config.clientId, config.clientSecret, config.redirectUri);

  app.get("/auth/discord", (request, response) => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    /*
     * Where they were going. Somebody who followed a link to a table and was
     * asked to sign in should land back at that table, not at the front door
     * having forgotten why they came.
     */
    const to = safeReturn(request.query["to"]);
    if (to === null) {
      delete request.session.returnTo;
    } else {
      request.session.returnTo = to;
    }
    // Both bound to the session and single-use, so a callback cannot be
    // replayed, forged from another tab, or intercepted mid-flight.
    request.session.oauthState = state;
    request.session.oauthVerifier = verifier;
    const url = discord.createAuthorizationURL(state, verifier, ["identify"]);
    response.redirect(url.toString());
  });

  app.get(
    "/auth/discord/callback",
    handle(async (request, response) => {
      const code = typeof request.query["code"] === "string" ? request.query["code"] : null;
      const state = typeof request.query["state"] === "string" ? request.query["state"] : null;
      const expected = request.session.oauthState;
      const verifier = request.session.oauthVerifier;
      delete request.session.oauthState;
      delete request.session.oauthVerifier;

      if (expected === undefined || verifier === undefined) {
        // The session that started this did not come back with the callback,
        // so there is nothing to check the reply against. Almost always the
        // cookie was never set: a `secure` cookie behind a proxy that Express
        // has not been told to trust, or a browser refusing a third-party one.
        return giveUp(response, config, "no-session");
      }
      if (code === null || state === null) {
        return giveUp(response, config, "no-code");
      }
      if (state !== expected) {
        return giveUp(response, config, "state-mismatch");
      }

      try {
        const tokens = await discord.validateAuthorizationCode(code, verifier);
        const profileResponse = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokens.accessToken()}` },
        });
        if (!profileResponse.ok) {
          return giveUp(response, config, "discord-refused-profile", {
            status: profileResponse.status,
          });
        }
        const discordUser = (await profileResponse.json()) as DiscordUser;
        const profile = await store.upsertDiscordUser({
          discordId: discordUser.id,
          name: discordUser.global_name ?? discordUser.username,
          avatar: avatarUrl(discordUser),
          accentColor: discordUser.accent_color ?? null,
        });
        request.session.userId = profile.id;
        // Single use, like the state and the verifier: a stale destination is
        // a surprise the next time somebody signs in from the front door.
        const to = request.session.returnTo ?? "/";
        delete request.session.returnTo;
        response.redirect(`${config.clientUrl}${to}?signin=ok`);
      } catch (error) {
        // An OAuth2RequestError used to be swallowed here as "expected". It is
        // not: a mismatched redirect URI and a wrong client secret both arrive
        // this way, and both are silent in exactly the deployment where you
        // cannot afford to guess.
        return giveUp(
          response,
          config,
          error instanceof OAuth2RequestError ? "discord-rejected-exchange" : "unexpected",
          { error },
        );
      }
    }),
  );
}

/**
 * Where to put somebody down after they sign in.
 *
 * A path on this site and nothing else. This is the open-redirect boundary:
 * the value arrives in a query string, so anybody can put anything in it, and
 * a signed-in redirect to a host of somebody else's choosing is how a phishing
 * page gets to look like it came from here.
 *
 * Refused outright rather than tidied up. There is no cleaning branch on
 * purpose — every open redirect worth the name got through one.
 */
export function safeReturn(to: unknown): string | null {
  if (typeof to !== "string" || to.length === 0 || to.length > 120) {
    return null;
  }
  // A browser reads "//host" and "/\host" as absolute, whatever they look like.
  if (!to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) {
    return null;
  }
  // Letters, digits and the few punctuation marks a path of ours can hold. No
  // query, no fragment, no escapes: nothing here needs them.
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(to)) {
    return null;
  }
  return to;
}
