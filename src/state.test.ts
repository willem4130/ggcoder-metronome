import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettings,
  defaultUiState,
  loadLibrary,
  loadSetlists,
  loadUiState,
  resolveSongs,
  saveLibrary,
  saveSetlists,
  saveUiState,
  type LibrarySong,
  type Preset,
  type Setlist,
  type SetlistV1,
} from "./state";

const PRESETS_KEY = "ggcoder-metronome.presets.v1";
const SETLISTS_V1_KEY = "ggcoder-metronome.setlists.v1";
const SETLISTS_KEY = "ggcoder-metronome.setlists.v2";
const LIBRARY_KEY = "ggcoder-metronome.library.v1";

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
