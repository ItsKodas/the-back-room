/** Numbers as the desk prints them. */
export const fmt = (n: number) => n.toLocaleString("en-US");

/** A desk read. Null for a refusal or no connection — the tab says so. */
export async function adminGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { credentials: "include" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * A desk write, with the server's own words when it refuses. The server
 * decides every limit; this only carries its answer back.
 */
export async function adminPost<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; body: T } | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return { ok: false, status: response.status, error: answer.error ?? "That was refused." };
    }
    return { ok: true, body: answer as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the room." };
  }
}
