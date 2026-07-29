import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BPM } from "./timing";
import {
  createBackupPayload,
  defaultSettings,
  defaultUiState,
  loadLastSettings,
  loadLibrary,
  loadSetlists,
  loadUiState,
  normalizeSettings,
  parseBackupPayload,
  resolveSongReferences,
  resolveSongs,
  restoreBackupPayload,
  saveLastSettings,
  saveLibrary,
  saveSetlists,
  saveUiState,
  type BackupPayload,
  type LibrarySong,
  type Preset,
  type Setlist,
  type SetlistV1,
} from "./state";

const PRESETS_KEY = "ggcoder-metronome.presets.v1";
const LAST_KEY = "ggcoder-metronome.last.v1";
const SETLISTS_V1_KEY = "ggcoder-metronome.setlists.v1";
const SETLISTS_KEY = "ggcoder-metronome.setlists.v2";
const LIBRARY_KEY = "ggcoder-metronome.library.v1";
const UI_KEY = "ggcoder-metronome.ui.v1";

/** Minimal in-memory localStorage so tests run without a DOM environment. */
function stubLocalStorage(): void {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(stubLocalStorage);

function librarySong(overrides: Partial<LibrarySong> = {}): LibrarySong {
  return {
    id: "lib-1",
    title: "Song",
    artist: "",
    settings: defaultSettings(),
    ...overrides,
  };
}

describe("loadSetlists migration from v1", () => {
  it("moves embedded songs into the library, preserving ids and order", () => {
    const v1: SetlistV1[] = [
      {
        id: "sl-1",
        name: "Friday gig",
        songs: [
          { id: "s-1", name: "Tom Sawyer", settings: { ...defaultSettings(), bpm: 88 } },
          { id: "s-2", name: "YYZ", settings: { ...defaultSettings(), bpm: 142 } },
        ],
      },
    ];
    localStorage.setItem(SETLISTS_V1_KEY, JSON.stringify(v1));

    const setlists = loadSetlists();

    expect(setlists).toEqual([
      { id: "sl-1", name: "Friday gig", songIds: ["s-1", "s-2"] },
    ]);
    const library = loadLibrary();
    expect(library.map((s) => s.id)).toEqual(["s-1", "s-2"]);
    expect(library.map((s) => s.title)).toEqual(["Tom Sawyer", "YYZ"]);
    expect(library.map((s) => s.artist)).toEqual(["", ""]);
    expect(library.map((s) => s.settings.bpm)).toEqual([88, 142]);
  });

  it("persists v2 + library and keeps the v1 key as backup", () => {
    const v1: SetlistV1[] = [
      { id: "sl-1", name: "Gig", songs: [{ id: "s-1", name: "One", settings: defaultSettings() }] },
    ];
    localStorage.setItem(SETLISTS_V1_KEY, JSON.stringify(v1));

    loadSetlists();

    expect(localStorage.getItem(SETLISTS_KEY)).not.toBeNull();
    expect(localStorage.getItem(LIBRARY_KEY)).not.toBeNull();
    expect(localStorage.getItem(SETLISTS_V1_KEY)).toBe(JSON.stringify(v1));
  });

  it("dedupes songs with identical title and settings across setlists", () => {
    const settings = { ...defaultSettings(), bpm: 100 };
    const v1: SetlistV1[] = [
      { id: "sl-1", name: "A", songs: [{ id: "s-1", name: "Shared", settings }] },
      { id: "sl-2", name: "B", songs: [{ id: "s-9", name: "Shared", settings }] },
    ];
    localStorage.setItem(SETLISTS_V1_KEY, JSON.stringify(v1));

    const setlists = loadSetlists();

    expect(loadLibrary()).toHaveLength(1);
    expect(setlists[0].songIds).toEqual(["s-1"]);
    expect(setlists[1].songIds).toEqual(["s-1"]);
  });

  it("keeps songs separate when titles match but settings differ", () => {
    const v1: SetlistV1[] = [
      {
        id: "sl-1",
        name: "A",
        songs: [
          { id: "s-1", name: "Same name", settings: { ...defaultSettings(), bpm: 90 } },
          { id: "s-2", name: "Same name", settings: { ...defaultSettings(), bpm: 120 } },
        ],
      },
    ];
    localStorage.setItem(SETLISTS_V1_KEY, JSON.stringify(v1));

    const setlists = loadSetlists();

    expect(loadLibrary()).toHaveLength(2);
    expect(setlists[0].songIds).toEqual(["s-1", "s-2"]);
  });

  it("does not migrate when v2 setlists already exist", () => {
    const existing: Setlist[] = [{ id: "sl-1", name: "Current", songIds: [] }];
    localStorage.setItem(SETLISTS_KEY, JSON.stringify(existing));
    localStorage.setItem(
      SETLISTS_V1_KEY,
      JSON.stringify([{ id: "old", name: "Old", songs: [] }]),
    );

    expect(loadSetlists()).toEqual(existing);
    expect(loadLibrary()).toEqual([]);
  });
});

describe("loadSetlists migration from legacy presets", () => {
  it("chains presets into a 'My presets' setlist backed by the library", () => {
    const presets: Preset[] = [
      { name: "Tom Sawyer", settings: { ...defaultSettings(), bpm: 88 } },
      { name: "YYZ", settings: { ...defaultSettings(), bpm: 142 } },
    ];
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));

    const setlists = loadSetlists();

    expect(setlists).toHaveLength(1);
    expect(setlists[0].name).toBe("My presets");
    const songs = resolveSongs(setlists[0], loadLibrary());
    expect(songs.map((s) => s.title)).toEqual(["Tom Sawyer", "YYZ"]);
    expect(songs.map((s) => s.settings.bpm)).toEqual([88, 142]);
    expect(localStorage.getItem(PRESETS_KEY)).not.toBeNull();
  });

  it("returns empty when nothing is stored", () => {
    expect(loadSetlists()).toEqual([]);
  });
});

describe("resolveSongs", () => {
  it("maps ids to library songs in setlist order", () => {
    const library = [
      librarySong({ id: "a", title: "First" }),
      librarySong({ id: "b", title: "Second" }),
    ];
    const setlist: Setlist = { id: "sl", name: "Gig", songIds: ["b", "a"] };

    expect(resolveSongs(setlist, library).map((s) => s.title)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("drops dangling ids", () => {
    const library = [librarySong({ id: "a" })];
    const setlist: Setlist = { id: "sl", name: "Gig", songIds: ["a", "gone"] };

    expect(resolveSongs(setlist, library).map((s) => s.id)).toEqual(["a"]);
  });

  it("returns empty for a null setlist", () => {
    expect(resolveSongs(null, [librarySong()])).toEqual([]);
  });
});

describe("library round-trip", () => {
  it("saves and reloads library songs unchanged", () => {
    const songs: LibrarySong[] = [
      librarySong({ id: "a", title: "Opener", artist: "Rush", band: "Cover band" }),
      librarySong({ id: "b", title: "Closer", settings: { ...defaultSettings(), bpm: 178 } }),
    ];

    saveLibrary(songs);

    expect(loadLibrary()).toEqual(songs);
  });

  it("returns empty when nothing is stored", () => {
    expect(loadLibrary()).toEqual([]);
  });
});

describe("setlist round-trip", () => {
  it("saves and reloads v2 setlists unchanged", () => {
    const setlists: Setlist[] = [
      { id: "sl-1", name: "Friday gig", songIds: ["s-1", "s-2"] },
      { id: "sl-2", name: "Practice", songIds: [] },
    ];

    saveSetlists(setlists);

    expect(loadSetlists()).toEqual(setlists);
  });
});

describe("UI state round-trip", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadUiState()).toEqual(defaultUiState());
  });

  it("saves and reloads flags and active ids", () => {
    const ui = {
      ...defaultUiState(),
      satellitesPaneHidden: true,
      collapsedPanels: ["trainers"],
      activeSetlistId: "sl-1",
      activeSongId: "s-2",
    };

    saveUiState(ui);

    expect(loadUiState()).toEqual(ui);
  });
});

describe("deep persisted-data normalization", () => {
  it("repairs malformed nested settings and clamps every finite range", () => {
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        bpm: 999,
        beatsPerBar: 3,
        accents: ["mute", "invalid"],
        mix: { quarter: -4, eighth: 0.4, sixteenth: 7, triplet: "loud" },
        voice: "noise",
        masterVolume: -1,
        gap: { enabled: "yes", playBars: 99, muteBars: 0 },
        speed: { enabled: true, toBpm: 999, stepBpm: 99, everyBars: -2 },
      }),
    );

    expect(loadLastSettings()).toEqual({
      bpm: MAX_BPM,
      beatsPerBar: 3,
      accents: ["mute", "normal", "normal"],
      mix: { quarter: 0, eighth: 0.4, sixteenth: 1, triplet: 0 },
      voice: "click",
      masterVolume: 0,
      gap: { enabled: false, playBars: 32, muteBars: 1 },
      speed: { enabled: true, toBpm: MAX_BPM, stepBpm: 20, everyBars: 1 },
    });
  });

  it("uses nested defaults instead of shallow-merging partial objects", () => {
    const normalized = normalizeSettings({
      bpm: 90,
      mix: { eighth: 0.5 },
      gap: { enabled: true },
      speed: { toBpm: 140 },
    });

    expect(normalized.mix).toEqual({ quarter: 1, eighth: 0.5, sixteenth: 0, triplet: 0 });
    expect(normalized.gap).toEqual({ enabled: true, playBars: 4, muteBars: 2 });
    expect(normalized.speed).toEqual({ enabled: false, toBpm: 140, stepBpm: 2, everyBars: 4 });
    expect(normalized.accents).toEqual(defaultSettings().accents);
  });

  it("drops malformed records but preserves valid dangling song references", () => {
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify([
        { id: "", title: "Missing id", settings: defaultSettings() },
        { id: "valid", title: " Valid ", artist: 42, settings: { bpm: 92 } },
        "not a song",
      ]),
    );
    localStorage.setItem(
      SETLISTS_KEY,
      JSON.stringify([{ id: "sl", name: " Gig ", songIds: ["valid", "dangling", 12] }]),
    );

    expect(loadLibrary()).toEqual([
      { id: "valid", title: "Valid", artist: "", settings: { ...defaultSettings(), bpm: 92 } },
    ]);
    expect(loadSetlists()).toEqual([{ id: "sl", name: "Gig", songIds: ["valid", "dangling"] }]);
  });
});

describe("active-id-preserving migration", () => {
  it("chooses the active duplicate id as canonical during dedupe", () => {
    const shared = { ...defaultSettings(), bpm: 101 };
    const v1: SetlistV1[] = [
      { id: "one", name: "One", songs: [{ id: "first", name: "Shared", settings: shared }] },
      { id: "two", name: "Two", songs: [{ id: "active", name: "Shared", settings: shared }] },
    ];
    localStorage.setItem(SETLISTS_V1_KEY, JSON.stringify(v1));
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({ ...defaultUiState(), activeSetlistId: "two", activeSongId: "active" }),
    );

    expect(loadSetlists().map((setlist) => setlist.songIds)).toEqual([["active"], ["active"]]);
    expect(loadLibrary().map((song) => song.id)).toEqual(["active"]);
    expect(loadUiState().activeSongId).toBe("active");
  });
});

describe("resolved song source indexes", () => {
  it("retains exact source indexes around dangling ids", () => {
    const library = [librarySong({ id: "a" }), librarySong({ id: "b" })];
    const setlist: Setlist = {
      id: "sl",
      name: "Gig",
      songIds: ["gone-first", "b", "gone-middle", "a"],
    };

    expect(resolveSongReferences(setlist, library)).toEqual([
      { song: library[1], sourceIndex: 1 },
      { song: library[0], sourceIndex: 3 },
    ]);
  });
});

describe("versioned backups", () => {
  function validBackup(): BackupPayload {
    saveLibrary([librarySong({ id: "song", title: "Opener" })]);
    saveSetlists([{ id: "set", name: "Show", songIds: ["song"] }]);
    saveLastSettings({ ...defaultSettings(), bpm: 96 });
    saveUiState({ ...defaultUiState(), activeSetlistId: "set", activeSongId: "song" });
    return createBackupPayload();
  }

  it("creates and parses a complete version 1 payload", () => {
    const backup = validBackup();
    const parsed = parseBackupPayload(JSON.stringify(backup));

    expect(parsed.version).toBe(1);
    expect(parsed.library[0].title).toBe("Opener");
    expect(parsed.setlists[0].songIds).toEqual(["song"]);
    expect(parsed.lastSettings.bpm).toBe(96);
    expect(parsed.ui.activeSongId).toBe("song");
  });

  it("rejects malformed JSON and malformed valid-JSON data", () => {
    expect(() => parseBackupPayload("{"))
      .toThrow("not valid JSON");
    expect(() => parseBackupPayload(JSON.stringify({ version: 2 })))
      .toThrow("version is not supported");

    const malformed = {
      ...validBackup(),
      lastSettings: { ...defaultSettings(), gap: { enabled: true } },
    };
    expect(() => parseBackupPayload(JSON.stringify(malformed)))
      .toThrow("invalid metronome settings");
  });

  it("restores all current keys after validation", () => {
    const backup = validBackup();
    localStorage.clear();

    restoreBackupPayload(parseBackupPayload(JSON.stringify(backup)));

    expect(loadLibrary()[0].id).toBe("song");
    expect(loadSetlists()[0].id).toBe("set");
    expect(loadLastSettings().bpm).toBe(96);
    expect(loadUiState().activeSongId).toBe("song");
  });

  it("rolls back every key when a storage write fails", () => {
    const backup = validBackup();
    const previous = new Map<string, string>([
      [LIBRARY_KEY, "old-library"],
      [SETLISTS_KEY, "old-setlists"],
      [LAST_KEY, "old-settings"],
      [UI_KEY, "old-ui"],
    ]);
    let didFail = false;
    const failingStorage = {
      getItem: (key: string) => previous.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === LAST_KEY && !didFail) {
          didFail = true;
          throw new Error("quota");
        }
        previous.set(key, value);
      },
      removeItem: (key: string) => void previous.delete(key),
      clear: () => previous.clear(),
      key: (index: number) => [...previous.keys()][index] ?? null,
      get length() {
        return previous.size;
      },
    } as Storage;

    expect(() => restoreBackupPayload(backup, failingStorage))
      .toThrow("previous local data was preserved");
    expect(Object.fromEntries(previous)).toEqual({
      [LIBRARY_KEY]: "old-library",
      [SETLISTS_KEY]: "old-setlists",
      [LAST_KEY]: "old-settings",
      [UI_KEY]: "old-ui",
    });
  });
});
