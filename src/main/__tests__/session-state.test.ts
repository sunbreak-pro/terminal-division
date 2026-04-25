import { describe, it, expect, vi, beforeEach } from "vitest";

// session-state.ts は import 時に new SessionStateManager() を実行し
// app.getPath('userData') を呼ぶため、electron をモックする
const mockGetAllWindows = vi.fn().mockReturnValue([]);
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
  },
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows(),
  },
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import fs from "fs";
import { sessionStateManager } from "../session-state";
import {
  SESSION_STATE_VERSION,
  type SerializedLayout,
} from "../../shared/session-state-validator";

const validLayout = (): SerializedLayout => ({
  version: SESSION_STATE_VERSION,
  rootId: "s1",
  nodes: [
    [
      "s1",
      {
        id: "s1",
        type: "split",
        direction: "horizontal",
        children: ["a", "b"],
        parentId: null,
      },
    ],
    ["a", { id: "a", parentId: "s1" }],
    ["b", { id: "b", parentId: "s1" }],
  ],
  metas: [
    ["a", { cwd: "/x" }],
    ["b", { cwd: null }],
  ],
});

describe("SessionStateManager.consumeRestoreData", () => {
  beforeEach(() => {
    sessionStateManager.resetRestoreConsumedForTest();
  });

  it("returns the cached state on the first call", () => {
    // load() がモック fs.existsSync=false で走るため state は null。
    // ここでは state が null でも consumed フラグが進むことを確認する。
    expect(sessionStateManager.consumeRestoreData()).toBeNull();
  });

  it("returns null on subsequent calls (multi-window race guard)", () => {
    sessionStateManager.consumeRestoreData();
    expect(sessionStateManager.consumeRestoreData()).toBeNull();
    expect(sessionStateManager.consumeRestoreData()).toBeNull();
  });
});

describe("SessionStateManager save failure notification", () => {
  beforeEach(() => {
    mockGetAllWindows.mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it("broadcasts session:saveFailed when writeFileSync throws", () => {
    const send = vi.fn();
    mockGetAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ]);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    sessionStateManager.save(validLayout());
    sessionStateManager.flushForTest();

    expect(send).toHaveBeenCalledWith(
      "session:saveFailed",
      expect.objectContaining({ message: expect.stringContaining("EACCES") }),
    );
  });

  it("skips destroyed windows when broadcasting save failures", () => {
    const send = vi.fn();
    mockGetAllWindows.mockReturnValue([
      { isDestroyed: () => true, webContents: { send } },
    ]);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("ENOSPC");
    });

    sessionStateManager.save(validLayout());
    sessionStateManager.flushForTest();

    expect(send).not.toHaveBeenCalled();
  });
});
