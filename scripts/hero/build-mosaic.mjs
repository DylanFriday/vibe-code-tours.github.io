// Build a single composite avatar-mosaic image for the homepage hero.
// One optimized WebP instead of a video or 155 live <img> — best LCP, always
// current (re-run when builders change), accessible (static by default).
//
//   node scripts/hero/build-mosaic.mjs
//   npm run hero:mosaic
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import yaml from "js-yaml";
import sharp from "sharp";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const BUILDERS_DIR = path.join(ROOT, "src/content/builders");
const AVATAR_CACHE = path.join(here, "avatars");
const OUT = path.join(ROOT, "public/hero-mosaic.webp");

const TILE = 110; // px per avatar
const COLS = 20;
const GAP = 4;
const AV_SIZE = 120; // fetch size

// Deterministic shuffle (mulberry32) so the layout is stable between runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, seed) {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function loadHandles() {
  const handles = [];
  for (const f of fs.readdirSync(BUILDERS_DIR).filter((f) => f.endsWith(".md")).sort()) {
    const src = fs.readFileSync(path.join(BUILDERS_DIR, f), "utf8").replace(/\r\n/g, "\n");
    const m = src.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    let data;
    try {
      data = yaml.load(m[1]);
    } catch {
      continue;
    }
    const h = String(data?.github ?? "").trim();
    if (/^[A-Za-z0-9-]+$/.test(h)) handles.push(h);
  }
  return handles;
}

async function avatarBuffer(handle) {
  fs.mkdirSync(AVATAR_CACHE, { recursive: true });
  const dest = path.join(AVATAR_CACHE, `${handle}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest);
  try {
    const res = await fetch(`https://github.com/${encodeURIComponent(handle)}.png?size=${AV_SIZE}`, { redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    fs.writeFileSync(dest, buf);
    return buf;
  } catch {
    return null;
  }
}

async function run() {
  const handles = shuffle(loadHandles(), 0xa11ce);
  const rows = Math.ceil(handles.length / COLS);
  const width = COLS * TILE;
  const height = rows * TILE;

  // amber-tinted fallback tile for missing avatars
  const fallback = await sharp({
    create: { width: AV_SIZE, height: AV_SIZE, channels: 3, background: { r: 26, g: 18, b: 6 } },
  })
    .png()
    .toBuffer();

  const composites = [];
  let ok = 0;
  for (let i = 0; i < handles.length; i++) {
    const buf = (await avatarBuffer(handles[i])) || fallback;
    if (buf !== fallback) ok++;
    const tile = await sharp(buf)
      .resize(TILE - GAP, TILE - GAP, { fit: "cover" })
      .toBuffer();
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    composites.push({ input: tile, left: col * TILE + GAP / 2, top: row * TILE + GAP / 2 });
  }

  await sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 9, b: 11 } },
  })
    .composite(composites)
    .webp({ quality: 72 })
    .toFile(OUT);

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`✓ hero-mosaic.webp — ${handles.length} avatars (${ok} real), ${width}x${height}, ${kb} KB`);
}

run();
