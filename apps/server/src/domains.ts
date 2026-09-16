/**
 * Friendly addresses.
 *
 * A game gets a subdomain of its own — `greed.horizons.gg` — because that is
 * what people actually paste to each other, and "go to casino.horizons.gg then
 * click Greed" is not something anybody says out loud. The subdomain is a door
 * rather than a place: it sends you straight to the same page on the one real
 * origin, so there is a single host holding the session cookie and a single
 * address people bookmark.
 */

/** Paths the browser asks for on its own behalf, which must never be moved. */
const SERVICE = ["/api", "/auth", "/socket.io", "/healthz"];

/**
 * Where a request on a game's subdomain should be sent, or null to leave it be.
 *
 * @param hostname The host asked for, without a port.
 * @param path The path asked for, without a query string.
 * @param games Every game id the room knows about.
 * @param canonical The one origin the site really lives at.
 */
export function friendlyRedirect(
  hostname: string,
  path: string,
  games: readonly string[],
  canonical: string,
): string | null {
  const label = hostname.split(".")[0]?.toLowerCase() ?? "";
  if (!games.includes(label)) {
    return null;
  }
  if (SERVICE.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return null;
  }

  let origin: URL;
  try {
    origin = new URL(canonical);
  } catch {
    // No canonical origin to send anybody to, so nobody is sent anywhere.
    return null;
  }
  /*
   * The subdomain and the canonical host being the same is a configuration
   * anyone might arrive at — CLIENT_ORIGIN pointed at greed.horizons.gg, say —
   * and redirecting a host to itself is an infinite loop rather than a
   * mistake the browser can recover from.
   */
  if (origin.hostname.toLowerCase() === hostname.toLowerCase()) {
    return null;
  }

  // The bare subdomain is the only thing that needs a path inventing for it.
  // Everything else already knows where it is going and keeps its path — a
  // shared table code included.
  const wanted = path === "/" ? `/${label}` : path;
  return onto(origin, wanted);
}

/**
 * Where a request on the www twin of the canonical host should be sent, or
 * null to leave it be.
 *
 * Both answered the same page, which to a search engine is two copies of the
 * site splitting whatever standing it has between them. One of them is the
 * address, so the other says so with a 301. Either way round: the canonical
 * origin decides which of the pair is the real one.
 *
 * @param hostname The host asked for, without a port.
 * @param url The path asked for, with its query string.
 * @param canonical The one origin the site really lives at.
 */
export function canonicalRedirect(hostname: string, url: string, canonical: string): string | null {
  let origin: URL;
  try {
    origin = new URL(canonical);
  } catch {
    return null;
  }
  const asked = hostname.toLowerCase();
  const real = origin.hostname.toLowerCase();
  if (asked !== `www.${real}` && `www.${asked}` !== real) {
    return null;
  }
  // By then the page has already moved the browser, so anything still asking
  // here is mid-handshake, and a redirect would break it rather than fix it.
  const path = url.split("?")[0] ?? "";
  if (SERVICE.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return null;
  }
  return onto(origin, url);
}

/**
 * A path and query, on the canonical origin and nowhere else.
 *
 * Not `new URL(path, origin)`: a path is whatever the request line said, and
 * `//evil.example/x` resolved against an origin is a different host. Leading
 * slashes and backslashes are collapsed to one, so the host is always ours.
 */
function onto(origin: URL, path: string): string {
  return `${origin.origin}/${path.replace(/^[/\\]+/, "")}`;
}
