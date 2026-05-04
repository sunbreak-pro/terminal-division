import { app } from "electron";
import { join } from "path";
import fs from "fs";

// 右サイドバー（Markdown 表示エリア）の永続化状態。
// width は絶対値 px。最大幅は実行時のウィンドウ幅で renderer 側 clamp する。
// isOpen は Markdown クリック時の自動オープンを除く、明示的な開閉状態を保持。
interface RightSidebarState {
  width: number;
  isOpen: boolean;
}

const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
// 物理上限。実行時に画面幅の 50% まで renderer 側で再 clamp する。
const MAX_WIDTH = 4000;

class RightSidebarStateManager {
  private filePath: string;
  private state: RightSidebarState = {
    width: DEFAULT_WIDTH,
    isOpen: false,
  };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = join(app.getPath("userData"), "right-sidebar-state.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        if (raw && typeof raw.width === "number") {
          this.state.width = this.clamp(raw.width);
        }
        if (raw && typeof raw.isOpen === "boolean") {
          this.state.isOpen = raw.isOpen;
        }
      }
    } catch {
      this.state = { width: DEFAULT_WIDTH, isOpen: false };
    }
  }

  private clamp(width: number): number {
    if (!Number.isFinite(width)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
      } catch (e) {
        console.warn("[RightSidebarState] save error:", e);
      }
    }, 250);
  }

  getWidth(): number {
    return this.state.width;
  }

  setWidth(width: number): void {
    this.state.width = this.clamp(width);
    this.scheduleSave();
  }

  getOpen(): boolean {
    return this.state.isOpen;
  }

  setOpen(open: boolean): void {
    this.state.isOpen = !!open;
    this.scheduleSave();
  }
}

export const rightSidebarStateManager = new RightSidebarStateManager();
