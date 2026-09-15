import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Ports `fetch` refuses outright, from the Fetch standard's "bad port" list.
 *
 * `listen(0)` asks the OS for any free port, and on a machine whose dynamic
 * range starts low (Windows can be set to 1024–65535) that is occasionally one
 * of these. Node's fetch then fails with "bad port" before it ever connects, so
 * a server test flakes roughly once per few thousand servers started — rare
 * enough to pass on a rerun, common enough across a full suite to be seen.
 */
export const FETCH_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

function listenOn(http: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    http.once("error", failed);
    http.listen(port, () => {
      http.off("error", failed);
      resolve((http.address() as AddressInfo).port);
    });
  });
}

function closeOn(http: Server): Promise<void> {
  return new Promise((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
}

/**
 * Listens on a free port that `fetch` will actually talk to, and returns it.
 *
 * `first` exists so the retry can be tested: the OS will not hand out a blocked
 * port on demand, so the test asks for one directly.
 */
export async function listenForFetch(http: Server, first = 0): Promise<number> {
  let port = await listenOn(http, first);
  while (FETCH_BLOCKED_PORTS.has(port)) {
    await closeOn(http);
    port = await listenOn(http, 0);
  }
  return port;
}
