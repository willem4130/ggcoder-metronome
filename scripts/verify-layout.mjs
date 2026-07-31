import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = 5199;
const BASE_URL = `http://${HOST}:${PORT}/`;
const SCREENSHOT_DIR = ".gg/screenshots/layout";
const CALIBRATION_CLICK_INTERVAL_SECONDS = 0.65;
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

async function seededPage(browser, viewport, seed, options = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.addInitScript((payload) => {
    localStorage.clear();
    localStorage.setItem("ggcoder-metronome.library.v1", JSON.stringify(payload.library));
    localStorage.setItem("ggcoder-metronome.setlists.v2", JSON.stringify(payload.setlists));
    localStorage.setItem("ggcoder-metronome.last.v1", JSON.stringify(payload.settings));
    localStorage.setItem("ggcoder-metronome.ui.v1", JSON.stringify(payload.ui));
    if (payload.analysisPreferences) {
      localStorage.setItem("ggcoder-metronome.analysis.preferences.v1", JSON.stringify(payload.analysisPreferences));
    }
    if (payload.analysisHistory) {
      localStorage.setItem("ggcoder-metronome.analysis.history.v1", JSON.stringify(payload.analysisHistory));
    }

    window.__denyMic = payload.mediaMode === "denied";
    window.__holdMic = payload.mediaMode === "held";
    window.__scheduledAudioTimes = [];
    window.__worklets = [];
    let releaseMicrophone;
    window.__releaseMic = () => releaseMicrophone?.();

    class FakeAudioNode {
      connect(destination) { return destination; }
      disconnect() {}
    }
    class FakeAudioParam {
      value = 0;
      setValueAtTime(value) { this.value = value; }
      exponentialRampToValueAtTime(value) { this.value = value; }
    }
    class FakeTrack {
      label = "Mock USB microphone";
      onended = null;
      stop() {}
      getSettings() {
        return {
          deviceId: "mock-mic-1",
          latency: 0.012,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        };
      }
    }
    class FakeStream {
      track = new FakeTrack();
      getTracks() { return [this.track]; }
      getAudioTracks() { return [this.track]; }
    }
    class FakeAudioWorkletNode extends FakeAudioNode {
      port = { onmessage: null, postMessage() {}, close() {} };
      onprocessorerror = null;
      constructor() {
        super();
        window.__worklets.push(this);
      }
    }
    class FakeAudioContext {
      state = "running";
      destination = new FakeAudioNode();
      baseLatency = 0.01;
      outputLatency = 0.02;
      audioWorklet = { addModule: async () => undefined };
      get currentTime() { return performance.now() / 1000; }
      async resume() { this.state = "running"; }
      async suspend() { this.state = "suspended"; }
      createGain() {
        const node = new FakeAudioNode();
        node.gain = new FakeAudioParam();
        return node;
      }
      createBiquadFilter() {
        const node = new FakeAudioNode();
        node.frequency = new FakeAudioParam();
        node.Q = new FakeAudioParam();
        node.type = "lowpass";
        return node;
      }
      createMediaStreamSource() { return new FakeAudioNode(); }
      createOscillator() {
        const node = new FakeAudioNode();
        node.frequency = new FakeAudioParam();
        node.type = "sine";
        node.start = (time) => window.__scheduledAudioTimes.push(time);
        node.stop = () => undefined;
        return node;
      }
      createBufferSource() {
        const node = new FakeAudioNode();
        node.start = () => undefined;
        return node;
      }
      createBuffer(_channels, length) {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      }
    }

    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    window.AudioWorkletNode = FakeAudioWorkletNode;
    window.__emitOnset = (time, strength = 0.9) => {
      const worklet = window.__worklets.at(-1);
      worklet?.port.onmessage?.({
        data: { type: "onset", time, strength, detectorDelaySeconds: 128 / 48_000 },
      });
    };
    window.__emitLevel = (level) => {
      const worklet = window.__worklets.at(-1);
      worklet?.port.onmessage?.({ data: { type: "level", level } });
    };
    window.__disconnectMic = () => {
      const stream = window.__lastStream;
      stream?.track.onended?.();
    };
    window.__crashWorklet = () => window.__worklets.at(-1)?.onprocessorerror?.();

    if (payload.mediaMode === "unsupported") {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    } else {
      const mediaDevices = new EventTarget();
      mediaDevices.getUserMedia = async () => {
        if (window.__denyMic) throw new DOMException("Denied", "NotAllowedError");
        if (window.__holdMic) {
          await new Promise((resolve) => { releaseMicrophone = resolve; });
          window.__holdMic = false;
        }
        const stream = new FakeStream();
        window.__lastStream = stream;
        return stream;
      };
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
    }
  }, seed);
  const page = await context.newPage();
  if (options.clock) await page.clock.install();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#startstop");
  return { context, page };
}

async function assertResponsiveLayout(browser) {
  for (const width of [320, 390, 768, 1024, 1280, 1536]) {
    const { context, page } = await seededPage(browser, { width, height: 900 }, populatedSeed);
    try {
      const result = await page.evaluate(() => {
        const pillars = [...document.querySelectorAll(".pillar, .analysis-panel")]
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
        const tempo = document.querySelector(".pillar-metronome").getBoundingClientRect();
        const analysis = document.getElementById("analysis-panel").getBoundingClientRect();
        const setlist = document.getElementById("pillar-setlist").getBoundingClientRect();
        const tools = document.getElementById("pillar-satellites").getBoundingClientRect();
        return {
          innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          overlaps,
          dockDisplay: dock ? getComputedStyle(dock).display : "missing",
          longSongOverflows: longSongButton
            ? longSongButton.scrollWidth > longSongButton.clientWidth + 1
            : true,
          analysisOverflows: document.getElementById("analysis-panel").scrollWidth
            > document.getElementById("analysis-panel").clientWidth + 1,
          positions: {
            tempo: { top: tempo.top, bottom: tempo.bottom },
            analysis: { top: analysis.top, bottom: analysis.bottom },
            setlist: { top: setlist.top, bottom: setlist.bottom },
            tools: { top: tools.top, bottom: tools.bottom },
          },
          domOrder: [...document.getElementById("main-shell").children]
            .map((element) => element.id || element.className),
        };
      });

      assert.equal(result.innerWidth, width, `${width}px viewport was not applied`);
      assert.ok(result.pageWidth <= width, `${width}px layout overflows horizontally (${result.pageWidth}px)`);
      assert.deepEqual(result.overlaps, [], `${width}px pillars overlap`);
      assert.equal(result.longSongOverflows, false, `${width}px long song row overflows`);
      assert.equal(result.analysisOverflows, false, `${width}px Timing Lab overflows`);
      if (width < 760) {
        assert.ok(result.positions.analysis.top >= result.positions.tempo.bottom, `${width}px Timing Lab is not after tempo`);
        assert.ok(result.positions.setlist.top >= result.positions.analysis.bottom, `${width}px setlist is not after Timing Lab`);
      } else if (width < 1200) {
        assert.ok(result.positions.analysis.top >= Math.max(result.positions.tempo.bottom, result.positions.setlist.bottom), `${width}px Timing Lab is not below tempo and setlist`);
      } else {
        assert.ok(Math.abs(result.positions.analysis.top - result.positions.tempo.top) < 2, `${width}px Timing Lab does not lead the desktop workspace`);
        assert.ok(result.positions.setlist.top >= result.positions.analysis.bottom, `${width}px setlist is not below Timing Lab`);
      }
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

async function assertZoomAndDirection(browser) {
  const { context, page } = await seededPage(browser, { width: 390, height: 844 }, populatedSeed);
  try {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const zoomed = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      clippedControls: [...document.querySelectorAll("button, input, select")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).length,
    }));
    assert.ok(zoomed.document <= zoomed.viewport, "200% text causes horizontal overflow");
    assert.equal(zoomed.clippedControls, 0, "200% text clips an interactive control");

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
      document.documentElement.dir = "rtl";
    });
    const rtl = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(rtl.document <= rtl.viewport, "RTL layout causes horizontal overflow");

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const media = await page.evaluate(() => {
      const start = document.getElementById("startstop");
      start.focus();
      const styles = getComputedStyle(start);
      return {
        forcedColors: matchMedia("(forced-colors: active)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        focusVisible: styles.outlineStyle !== "none" && Number.parseFloat(styles.outlineWidth) >= 2,
        transitionDuration: Number.parseFloat(styles.transitionDuration),
      };
    });
    assert.ok(media.forcedColors, "Forced-colors emulation did not activate");
    assert.ok(media.reducedMotion, "Reduced-motion emulation did not activate");
    assert.ok(media.focusVisible, "Forced-colors mode lost the visible focus outline");
    assert.ok(media.transitionDuration <= 0.01, "Reduced-motion mode retained a long transition");
  } finally {
    await context.close();
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

async function assertAnalysisWorkflow(browser) {
  const { context, page } = await seededPage(browser, { width: 1280, height: 1000 }, populatedSeed);
  try {
    assert.equal(await page.locator("#analysis-state").textContent(), "Mic off");
    await page.click("#analysis-toggle");
    await page.locator("#analysis-state").filter({ hasText: "Live" }).waitFor();
    await page.evaluate(() => {
      window.__emitLevel(0.72);
      for (let index = 0; index < 22; index += 1) window.__emitOnset(10 + index * 0.5);
    });
    assert.notEqual(await page.locator("#analysis-bpm").textContent(), "--", "Live analysis did not report BPM");
    assert.ok(Number(await page.locator("#analysis-hits").textContent().then((text) => text.split(" ")[0])) >= 8);
    assert.equal(await page.locator("#analysis-mode").textContent(), "Free play");
    assert.equal(await page.locator("#analysis-early-label").textContent(), "shorter");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/1280-analysis-live.png`, fullPage: true });

    await page.click("#analysis-toggle");
    assert.equal(await page.locator("#analysis-state").textContent(), "Complete");
    assert.equal(await page.locator("#analysis-history-list li").count(), 1);
    const stored = await page.evaluate(() => JSON.parse(
      localStorage.getItem("ggcoder-metronome.analysis.history.v1"),
    ));
    assert.equal(stored.length, 1, "Completed analysis was not saved");
    assert.equal("onsets" in stored[0], false, "Raw onset data leaked into history");

    const downloadPromise = page.waitForEvent("download");
    await page.click("#analysis-export");
    const download = await downloadPromise;
    assert.ok((await download.suggestedFilename()).endsWith(".csv"), "Timing history export is not CSV");

    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#analysis-history-list button");
    assert.equal(await page.locator("#analysis-history-list li").count(), 0, "Session delete failed");
    await page.click("#analysis-reset");
    assert.equal(await page.locator("#analysis-state").textContent(), "Mic off");

    await page.click("#analysis-toggle");
    await page.locator("#analysis-state").filter({ hasText: "Live" }).waitFor();
    await page.click("#startstop");
    await page.locator("#analysis-mode").filter({ hasText: "Metronome sync" }).waitFor();
    assert.equal(await page.locator("#analysis-hits").textContent(), "0 hits", "Mode change retained incompatible hits");
    await page.click("#startstop");
    await page.locator("#analysis-mode").filter({ hasText: "Free play" }).waitFor();
    await page.click("#analysis-toggle");
  } finally {
    await context.close();
  }
}

async function assertAnalysisFailureStates(browser) {
  const held = await seededPage(
    browser,
    { width: 390, height: 844 },
    { ...emptySeed, mediaMode: "held" },
  );
  try {
    await held.page.click("#analysis-toggle");
    assert.equal(await held.page.locator("#analysis-state").textContent(), "Requesting permission");
    await held.page.evaluate(() => window.__releaseMic());
    await held.page.locator("#analysis-state").filter({ hasText: "Warming up" }).waitFor();
    await held.page.locator("#analysis-state").filter({ hasText: "Live" }).waitFor();
    await held.page.evaluate(() => window.__disconnectMic());
    assert.equal(await held.page.locator("#analysis-state").textContent(), "Mic disconnected");
  } finally {
    await held.context.close();
  }

  const denied = await seededPage(
    browser,
    { width: 390, height: 844 },
    { ...emptySeed, mediaMode: "denied" },
  );
  try {
    await denied.page.click("#analysis-toggle");
    await denied.page.locator("#analysis-state").filter({ hasText: "Permission denied" }).waitFor();
    await denied.page.evaluate(() => { window.__denyMic = false; });
    await denied.page.click("#analysis-toggle");
    await denied.page.locator("#analysis-state").filter({ hasText: "Live" }).waitFor();
    await denied.page.evaluate(() => window.__crashWorklet());
    assert.equal(await denied.page.locator("#analysis-state").textContent(), "Processing error");
  } finally {
    await denied.context.close();
  }

  const unsupported = await seededPage(
    browser,
    { width: 390, height: 844 },
    { ...emptySeed, mediaMode: "unsupported" },
  );
  try {
    assert.equal(await unsupported.page.locator("#analysis-state").textContent(), "Unsupported");
    assert.ok(await unsupported.page.locator("#analysis-toggle").isDisabled());
  } finally {
    await unsupported.context.close();
  }
}

async function assertCalibrationWorkflow(browser) {
  const { context, page } = await seededPage(
    browser,
    { width: 1024, height: 900 },
    populatedSeed,
    { clock: true },
  );
  try {
    await page.click("#analysis-calibrate");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "calibration-begin");
    await page.focus("#calibration-close");
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.getElementById("calibration-dialog").contains(document.activeElement)),
      "Calibration dialog focus escaped",
    );
    await page.click("#calibration-begin");
    assert.equal(await page.locator("#analysis-state").textContent(), "Calibrating");
    const clickTimes = await page.evaluate(() => window.__scheduledAudioTimes.slice(-10));
    assert.equal(clickTimes.length, 10, "Calibration did not schedule ten clicks");
    await page.evaluate((times) => {
      times.forEach((time, index) => window.__emitOnset(time + (80 + (index % 3) - 1) / 1000));
    }, clickTimes);
    await page.clock.fastForward((10 * CALIBRATION_CLICK_INTERVAL_SECONDS + 1) * 1000);
    await page.locator("#calibration-status").filter({ hasText: "Measured" }).waitFor();
    assert.equal(await page.locator("#analysis-offset").inputValue(), "80");
    const saved = await page.evaluate(() => JSON.parse(
      localStorage.getItem("ggcoder-metronome.analysis.preferences.v1"),
    ));
    assert.equal(saved.calibration.quality, "measured");

    await page.click("#calibration-begin");
    await page.clock.fastForward((10 * CALIBRATION_CLICK_INTERVAL_SECONDS + 1) * 1000);
    await page.locator("#calibration-status").filter({ hasText: "required" }).waitFor();
    assert.equal(await page.locator("#analysis-state").textContent(), "Processing error");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/1024-calibration-failure.png` });

    await page.click("#calibration-close");
    assert.equal(await page.locator("#calibration-dialog").getAttribute("open"), null);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "analysis-calibrate");
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
  await assertZoomAndDirection(browser);
  await assertEmptyTransport(browser);
  await assertCollapsedPillars(browser);
  await assertSongWorkflow(browser);
  await assertReferenceAndTransportBehavior(browser);
  await assertLibraryAndShortcutBehavior(browser);
  await assertAnalysisWorkflow(browser);
  await assertAnalysisFailureStates(browser);
  await assertCalibrationWorkflow(browser);
  console.log("Browser verification passed: responsive, accessibility media, existing workflows, Timing Lab states/history/CSV, mocked microphone failures, and calibration success/failure.");
} finally {
  await browser?.close();
  await stopServer(server);
}
