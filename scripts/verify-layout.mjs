/**
 * Seeds a v1 setlists payload (to exercise migration), then screenshots the
 * desktop layout at several widths and probes for overlapping panels and
 * flush pillar bottoms. Run with the dev server on :5199.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5199/";
const OUT = ".gg/screenshots/layout";
mkdirSync(OUT, { recursive: true });

const defaults = {
  bpm: 120,
  beatsPerBar: 4,
  accents: ["accent", "normal", "normal", "normal"],
  mix: { quarter: 1, eighth: 0, sixteenth: 0, triplet: 0 },
  voice: "click",
  masterVolume: 0.8,
  gap: { enabled: false, playBars: 4, muteBars: 2 },
  speed: { enabled: false, toBpm: 180, stepBpm: 2, everyBars: 4 },
};

const v1Payload = [
  {
    id: "sl-1",
    name: "Friday gig",
    songs: [
      { id: "s-1", name: "Tom Sawyer", settings: { ...defaults, bpm: 88 } },
      {
        id: "s-2",
        name: "An Extremely Long Song Title That Used To Be Truncated On Desktop",
        settings: { ...defaults, bpm: 142 },
      },
      { id: "s-3", name: "YYZ", settings: { ...defaults, bpm: 142 } },
      { id: "s-4", name: "Limelight", settings: { ...defaults, bpm: 132 } },
      { id: "s-5", name: "Subdivisions", settings: { ...defaults, bpm: 128 } },
    ],
  },
];

async function probe(page) {
  return page.evaluate(() => {
    const rects = [...document.querySelectorAll(".pillar")].map((p) => {
      const r = p.getBoundingClientRect();
      return { id: p.id || "metronome", bottom: Math.round(r.bottom) };
    });
    const overlaps = [];
    const els = [...document.querySelectorAll("section.panel, .pillar-rail")];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect();
        const b = els[j].getBoundingClientRect();
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 2 && y > 2) overlaps.push([i, j, Math.round(x), Math.round(y)]);
      }
    }
    const title = [...document.querySelectorAll(".song-title")].find((t) =>
      t.textContent.includes("Extremely"),
    );
    const truncated = title ? title.scrollWidth > title.clientWidth + 1 : null;
    const transport = document.getElementById("face-transport");
    return {
      pillarBottoms: rects,
      overlaps,
      longTitleTruncated: truncated,
      transportHidden: transport?.hidden,
      transportNow: document.getElementById("transport-now")?.textContent,
      transportNext: document.getElementById("transport-next")?.textContent,
    };
  });
}

const browser = await chromium.launch();
const page = await browser.newPage();

// Seed v1 payload before the app boots.
await page.addInitScript((payload) => {
  if (!localStorage.getItem("ggcoder-metronome.seeded")) {
    localStorage.clear();
    localStorage.setItem("ggcoder-metronome.setlists.v1", JSON.stringify(payload));
    localStorage.setItem("ggcoder-metronome.seeded", "1");
  }
}, v1Payload);

for (const width of [1280, 1536, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE);
  await page.waitForSelector(".song-list li");
  console.log(`--- ${width}px expanded ---`);
  console.log(JSON.stringify(await probe(page), null, 1));
  await page.screenshot({ path: `${OUT}/${width}-expanded.png` });
}

// Migration integrity: old key intact, v2 + library written.
const keys = await page.evaluate(() => ({
  v1: localStorage.getItem("ggcoder-metronome.setlists.v1") !== null,
  v2: JSON.parse(localStorage.getItem("ggcoder-metronome.setlists.v2")),
  library: JSON.parse(localStorage.getItem("ggcoder-metronome.library.v1")).map((s) => s.title),
}));
console.log("--- migration ---");
console.log(JSON.stringify(keys, null, 1));

// Transport: load first song via Next, then again; check face readout.
await page.setViewportSize({ width: 1280, height: 900 });
await page.click("#song-next");
await page.click("#song-next");
console.log("--- after two Next clicks (1280) ---");
console.log(JSON.stringify(await probe(page), null, 1));
await page.screenshot({ path: `${OUT}/1280-transport.png` });

// Collapsed variants.
await page.click("#rail-satellites");
await page.screenshot({ path: `${OUT}/1280-satellites-collapsed.png` });
await page.click("#rail-setlist");
console.log("--- both collapsed (1280) ---");
console.log(JSON.stringify(await probe(page), null, 1));
await page.screenshot({ path: `${OUT}/1280-both-collapsed.png` });

await browser.close();
