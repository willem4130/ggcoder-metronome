import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettings,
  defaultUiState,
  loadSetlists,
  loadUiState,
  saveSetlists,
  saveUiState,
  type Preset,
  type Setlist,
} from "./state";

const PRESETS_KEY = "ggcoder-metronome.presets.v1";
const SETLISTS_KEY = "ggcoder-metronome.setlists.v1";

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

describe("loadSetlists migration", () => {
  it("wraps legacy presets as songs in a 'My presets' setlist, preserving order", () => {
    const presets: Preset[] = [
      { name: "Tom Sawyer", settings: { ...defaultSettings(), bpm: 88 } },
      { name: "YYZ", settings: { ...defaultSettings(), bpm: 142 } },
    ];
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));

    const setlists = loadSetlists();

    expect(setlists).toHaveLength(1);
    expect(setlists[0].name).toBe("My presets");
    expect(setlists[0].songs.map((s) => s.name)).toEqual(["Tom Sawyer", "YYZ"]);
    expect(setlists[0].songs.map((s) => s.settings.bpm)).toEqual([88, 142]);
    expect(setlists[0].songs.every((s) => s.id.length > 0)).toBe(true);
  });

  it("persists the migrated setlists and keeps the legacy key as backup", () => {
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([{ name: "Groove", settings: defaultSettings() }]),
    );

    loadSetlists();

    expect(localStorage.getItem(SETLISTS_KEY)).not.toBeNull();
    expect(localStorage.getItem(PRESETS_KEY)).not.toBeNull();
  });

  it("does not migrate when setlists already exist", () => {
    const existing: Setlist[] = [
      { id: "sl-1", name: "Friday gig", songs: [] },
    ];
    localStorage.setItem(SETLISTS_KEY, JSON.stringify(existing));
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([{ name: "Old", settings: defaultSettings() }]),
    );

    expect(loadSetlists()).toEqual(existing);
  });

  it("returns empty when nothing is stored", () => {
    expect(loadSetlists()).toEqual([]);
  });
});

describe("setlist round-trip", () => {
  it("saves and reloads setlists unchanged", () => {
    const setlists: Setlist[] = [
      {
        id: "sl-1",
        name: "Friday gig",
        songs: [
          { id: "s-1", name: "Opener", settings: { ...defaultSettings(), bpm: 96 } },
          { id: "s-2", name: "Closer", settings: { ...defaultSettings(), bpm: 178 } },
        ],
      },
      { id: "sl-2", name: "Practice", songs: [] },
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
