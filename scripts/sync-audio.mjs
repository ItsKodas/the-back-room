/**
 * Copies whatever is in assets/audio/raw into the web app's public folder and
 * writes a manifest of what landed.
 *
 * This is what makes the drop-zone workflow work: put a file in
 * assets/audio/raw/dice/, restart the dev server, and the game picks it up.
 * Nothing needs renaming and no code needs editing — the manifest is generated
 * from whatever is actually there.
 */
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const source = join(root, "assets", "audio", "raw");
const target = join(root, "apps", "web", "public", "audio");

/** Folders we mirror, in the order the game cares about them. */
const GROUPS = ["dice", "cards", "coins", "chips", "slots", "ui", "stingers", "ambience"];
const PLAYABLE = new Set([".mp3", ".ogg", ".wav", ".m4a", ".webm"]);

async function filesIn(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && PLAYABLE.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const manifest = {};
  let copied = 0;

  for (const group of GROUPS) {
    const names = await filesIn(join(source, group));
    if (names.length === 0) {
      continue;
    }
    await mkdir(join(target, group), { recursive: true });
    for (const name of names) {
      await copyFile(join(source, group, name), join(target, group, name));
      copied += 1;
    }
    manifest[group] = names.map((name) => `/audio/${group}/${name}`);
  }

  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const groups = Object.keys(manifest);
  console.log(
    copied === 0
      ? "sync-audio: nothing in assets/audio/raw yet"
      : `sync-audio: ${copied} file(s) across ${groups.length} group(s): ${groups.join(", ")}`,
  );
}

await main();
