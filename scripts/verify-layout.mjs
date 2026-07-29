import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = 5199;
const BASE_URL = `http://${HOST}:${PORT}/`;
const SCREENSHOT_DIR = ".gg/screenshots/layout";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

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

const defaultUi = {
  setlistPaneHidden: false,
  satellitesPaneHidden: false,
  collapsedPanels: [],
  activeSetlistId: "sl-1",
  activeSongId: null,
  singleKeyShortcutsEnabled: true,
};

const populatedSeed = {
  library: [
    { id: "s-1", title: "Tom Sawyer", artist: "Rush", settings: { ...defaults, bpm: 88 } },
    {
      id: "s-2",
      title: "An Extremely Long Song Title That Must Wrap Without Breaking The Setlist Layout At Any Supported Width",
      artist: "An Artist With A Deliberately Long Name",
      band: "Cover band",
      settings: { ...defaults, bpm: 142 },
    },
    { id: "s-3", title: "YYZ", artist: "Rush", settings: { ...defaults, bpm: 142 } },
  ],
  setlists: [
    { id: "sl-1", name: "Friday gig with a deliberately long setlist name", songIds: ["dangling", "s-1", "s-2"] },
  ],
  settings: defaults,
  ui: defaultUi,
};

const emptySeed = {
  library: [],
  setlists: [],
  settings: defaults,
  ui: { ...defaultUi, activeSetlistId: null },
};

function startServer() {
  const output = [];
  const child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", HOST, "--port", String(PORT), "--strictPort"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return { child, output };
}

async function waitForServer(server) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Vite exited before verification started.\n${server.output.join("")}`);
    }
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite.\n${server.output.join("")}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

async function seededPage(browser, viewport, seed) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((payload) => {
    localStorage.clear();
    localStorage.setItem("ggcoder-metronome.library.v1", JSON.stringify(payload.library));
    localStorage.setItem("ggcoder-metronome.setlists.v2", JSON.stringify(payload.setlists));
    localStorage.setItem("ggcoder-metronome.last.v1", JSON.stringify(payload.settings));
    localStorage.setItem("ggcoder-metronome.ui.v1", JSON.stringify(payload.ui));
  }, seed);
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#startstop");
  return { context, page };
}

async function assertResponsiveLayout(browser) {
  for (const width of [320, 390, 768, 1024, 1280, 1536]) {
    const { context, page } = await seededPage(browser, { width, height: 900 }, populatedSeed);
    try {
      const result = await page.evaluate(() => {
        const pillars = [...document.querySelectorAll(".pillar")]
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
        const overlaps = [];
        for (let first = 0; first < pillars.length; first += 1) {
          for (let second = first + 1; second < pillars.length; second += 1) {
            const a = pillars[first];
            const b = pillars[second];
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (x > 1 && y > 1) overlaps.push([first, second]);
          }
        }
        const dock = document.getElementById("mobile-transport");
        const longSongButton = document.querySelector(".song-list li:nth-child(2) .song-load");
        return {
          innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          overlaps,
          dockDisplay: dock ? getComputedStyle(dock).display : "missing",
          longSongOverflows: longSongButton
            ? longSongButton.scrollWidth > longSongButton.clientWidth + 1
            : true,
        };
      });

      assert.equal(result.innerWidth, width, `${width}px viewport was not applied`);
      assert.ok(result.pageWidth <= width, `${width}px layout overflows horizontally (${result.pageWidth}px)`);
      assert.deepEqual(result.overlaps, [], `${width}px pillars overlap`);
      assert.equal(result.longSongOverflows, false, `${width}px long song row overflows`);
      assert.equal(
        result.dockDisplay !== "none",
        width < 960,
        `${width}px mobile dock visibility is incorrect`,
      );

      if (width < 960) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const isReserved = await page.evaluate(() => {
          const dock = document.getElementById("mobile-transport").getBoundingClientRect();
          const lastPillar = document.getElementById("pillar-satellites").getBoundingClientRect();
          return lastPillar.bottom <= dock.top + 1;
        });
        assert.ok(isReserved, `${width}px mobile dock obscures the final pillar`);
      }

      if (width === 390 || width === 1280) {
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${width}-populated.png`,
          fullPage: true,
        });
      }
    } finally {
      await context.close();
    }
  }
}

async function assertEmptyTransport(browser) {
  const { context, page } = await seededPage(browser, { width: 390, height: 844 }, emptySeed);
  try {
    assert.equal(await page.locator("#face-transport").getAttribute("hidden"), "");
    assert.equal(await page.locator("#mobile-transport-now").textContent(), "No song loaded");
    assert.equal(await page.locator("#mobile-transport-next").textContent(), "No songs in setlist");
    assert.ok(await page.locator("#mobile-song-prev").isDisabled());
    assert.ok(await page.locator("#mobile-song-next").isDisabled());
  } finally {
    await context.close();
  }
}

async function assertCollapsedPillars(browser) {
  const { context, page } = await seededPage(browser, { width: 1280, height: 900 }, populatedSeed);
  try {
    await page.click("#rail-satellites");
    await page.click("#rail-setlist");
    assert.ok(await page.locator("#pillar-satellites-body").isHidden());
    assert.ok(await page.locator("#pillar-setlist-body").isHidden());
    assert.equal(await page.locator("#rail-satellites").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#rail-setlist").getAttribute("aria-expanded"), "false");
    const widths = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(widths.document <= widths.viewport, "Collapsed pillars cause horizontal overflow");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/1280-collapsed.png` });
  } finally {
    await context.close();
  }
}

async function assertSongWorkflow(browser) {
  const seed = {
    ...emptySeed,
    setlists: [{ id: "sl-1", name: "Practice", songIds: [] }],
    ui: defaultUi,
  };
  const { context, page } = await seededPage(browser, { width: 1024, height: 900 }, seed);
  try {
    await page.fill("#song-title", "First version");
    await page.fill("#song-artist", "The Band");
    await page.press("#song-title", "Enter");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("ggcoder-metronome.library.v1")).length === 1);

    await page.fill("#song-title", "First version");
    await page.click("#song-save");
    let saved = await page.evaluate(() => ({
      library: JSON.parse(localStorage.getItem("ggcoder-metronome.library.v1")),
      setlist: JSON.parse(localStorage.getItem("ggcoder-metronome.setlists.v2"))[0],
    }));
    assert.equal(saved.library.length, 2, "Save new song overwrote a title match");
    assert.equal(new Set(saved.library.map((song) => song.id)).size, 2, "New songs do not have unique ids");
    assert.equal(saved.setlist.songIds.length, 2, "Both new songs were not added to the setlist");

    await page.click(".song-list li:first-child .song-load");
    assert.equal(await page.locator(".song-list li:first-child .song-load").getAttribute("aria-current"), "true");
    await page.fill("#song-title", "Updated loaded song");
    await page.fill("#song-band", "Touring band");
    await page.click("#song-update");
    await page.fill("#song-band", "");
    await page.click("#song-update");
    saved = await page.evaluate(() => ({
      library: JSON.parse(localStorage.getItem("ggcoder-metronome.library.v1")),
      setlist: JSON.parse(localStorage.getItem("ggcoder-metronome.setlists.v2"))[0],
    }));
    assert.equal(saved.library.length, 2, "Update loaded song created a duplicate");
    assert.equal(saved.library[0].title, "Updated loaded song");
    assert.equal("band" in saved.library[0], false, "Update loaded song did not clear Band");
    assert.equal(saved.setlist.songIds.length, 2, "Update changed setlist references");
  } finally {
    await context.close();
  }
}

async function assertReferenceAndTransportBehavior(browser) {
  const { context, page } = await seededPage(browser, { width: 1280, height: 900 }, populatedSeed);
  try {
    await page.click(".song-list li:first-child .song-load");
    assert.equal(await page.locator("#transport-now").textContent(), "Tom Sawyer by Rush");
    assert.equal(await page.locator("#mobile-transport-now").textContent(), "Tom Sawyer by Rush");
    assert.equal(await page.locator("#bpm-value").textContent(), "88");
    assert.equal(await page.locator("#mobile-bpm-value").textContent(), "88");

    await page.click(".song-list li:first-child button[aria-label^='Remove']");
    const songIds = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ggcoder-metronome.setlists.v2"))[0].songIds,
    );
    assert.deepEqual(songIds, ["dangling", "s-2"], "Visible row removal mutated a filtered index");
  } finally {
    await context.close();
  }
}

async function assertLibraryAndShortcutBehavior(browser) {
  const seed = {
    ...populatedSeed,
    setlists: [{ id: "sl-1", name: "Friday gig", songIds: ["s-1"] }],
  };
  const { context, page } = await seededPage(browser, { width: 1024, height: 900 }, seed);
  try {
    const beforeInvalidRestore = await page.evaluate(() => ({
      library: localStorage.getItem("ggcoder-metronome.library.v1"),
      setlists: localStorage.getItem("ggcoder-metronome.setlists.v2"),
    }));

    await page.click("#library-open");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "library-search");
    await page.focus("#backup-restore");
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.getElementById("library-dialog").contains(document.activeElement)),
      "Tab focus escaped the modal dialog",
    );
    const reusableRow = page.locator("#library-list li").filter({ hasText: "Extremely Long Song" });
    await reusableRow.getByRole("button", { name: /Add .* to setlist/ }).click();
    const afterAdd = await page.evaluate(() => ({
      songIds: JSON.parse(localStorage.getItem("ggcoder-metronome.setlists.v2"))[0].songIds,
      storedSetlists: localStorage.getItem("ggcoder-metronome.setlists.v2"),
    }));
    assert.deepEqual(afterAdd.songIds, ["s-1", "s-2"], "Library reuse did not add the existing song id");
    assert.ok(await reusableRow.getByRole("button", { name: /Add .* to setlist/ }).isDisabled());

    await page.setInputFiles("#backup-file", {
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":1,"broken":true}'),
    });
    await page.locator("#library-status").filter({ hasText: "Current local data was not changed" }).waitFor();
    const afterInvalidRestore = await page.evaluate(() => ({
      library: localStorage.getItem("ggcoder-metronome.library.v1"),
      setlists: localStorage.getItem("ggcoder-metronome.setlists.v2"),
    }));
    assert.equal(afterInvalidRestore.library, beforeInvalidRestore.library, "Invalid restore changed the library");
    assert.equal(afterInvalidRestore.setlists, afterAdd.storedSetlists, "Invalid restore changed the setlists");
    assert.notEqual(afterInvalidRestore.setlists, beforeInvalidRestore.setlists, "Library add did not persist");

    await page.press("#library-search", "Escape");
    assert.equal(await page.locator("#library-dialog").getAttribute("open"), null);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "library-open");

    await page.click("#single-key-shortcuts");
    assert.ok(await page.locator("#single-key-shortcut-legend").isHidden());
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("ggcoder-metronome.ui.v1")).singleKeyShortcutsEnabled),
      false,
    );
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("n");
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("ggcoder-metronome.ui.v1")).activeSongId),
      null,
      "N shortcut remained active after disabling single-key shortcuts",
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.locator("#bpm-value").textContent(), "121", "Arrow shortcuts were incorrectly disabled");
  } finally {
    await context.close();
  }
}

const server = startServer();
let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch();
  await assertResponsiveLayout(browser);
  await assertEmptyTransport(browser);
  await assertCollapsedPillars(browser);
  await assertSongWorkflow(browser);
  await assertReferenceAndTransportBehavior(browser);
  await assertLibraryAndShortcutBehavior(browser);
  console.log("Browser verification passed: responsive, transport, song, library, restore, and shortcut assertions.");
} finally {
  await browser?.close();
  await stopServer(server);
}
