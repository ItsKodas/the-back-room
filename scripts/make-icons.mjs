/**
 * Draws the tab icon out into every size something will ask for it in.
 *
 * A phone installing this to a home screen, iOS drawing it on a rounded tile
 * and a browser filling a tab all want a PNG at a size of their own, and none
 * of them will take the SVG. So favicon.svg stays the one place the chip is
 * drawn, and these are pressed from it — which is the only way the mark on the
 * home screen and the mark in the tab stay the same mark.
 *
 * Generated rather than committed, like the audio: a drawing checked in beside
 * the drawing it was made from is a drawing that goes quietly stale.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const public_ = join(root, "apps", "web", "public");

/** The room's walls, for the icons that cannot be transparent. */
const GROUND = "#0d1015";

/**
 * What each icon is for, and how much room it needs around the chip.
 *
 * `pad` is in the chip's own 32-unit grid. A maskable icon is cropped to
 * whatever shape the platform likes — a circle on some Androids — and only the
 * middle 80% is guaranteed to survive, so the chip is drawn at 80% and the
 * rest is wall. Apple crops to a rounded square and composites on black, so
 * that one gets a ground whether it needs one or not.
 */
const ICONS = [
  { file: "icon-192.png", size: 192, pad: 0, ground: null },
  { file: "icon-512.png", size: 512, pad: 0, ground: null },
  { file: "icon-maskable-512.png", size: 512, pad: 3.2, ground: GROUND },
  { file: "apple-touch-icon.png", size: 180, pad: 1.6, ground: GROUND },
];

/** The chip itself, without the <svg> it arrived in. */
async function mark() {
  const svg = await readFile(join(public_, "favicon.svg"), "utf8");
  const opened = svg.indexOf(">", svg.indexOf("<svg"));
  const closed = svg.lastIndexOf("</svg>");
  if (opened === -1 || closed === -1) {
    throw new Error("favicon.svg is not an <svg>");
  }
  return svg.slice(opened + 1, closed);
}

/** One icon, as an SVG the right shape to be rasterised. */
function sheet(inner, { pad, ground }) {
  const scale = (32 - 2 * pad) / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  ${ground === null ? "" : `<rect width="32" height="32" fill="${ground}"/>`}
  <g transform="translate(${pad} ${pad}) scale(${scale})">${inner}</g>
</svg>`;
}

const inner = await mark();
await mkdir(public_, { recursive: true });
for (const icon of ICONS) {
  const png = new Resvg(sheet(inner, icon), {
    fitTo: { mode: "width", value: icon.size },
  })
    .render()
    .asPng();
  await writeFile(join(public_, icon.file), png);
  console.log(`icons: ${icon.file} (${icon.size}px)`);
}
