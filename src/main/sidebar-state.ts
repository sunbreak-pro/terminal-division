import { app } from "electron";
import { join } from "path";
import fs from "fs";

interface SidebarState {
  width: number;
}

const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 600;

class SidebarStateManager {
  private filePath: string;
  private state: SidebarState = { width: DEFAULT_WIDTH };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = join(app.getPath("userData"), "sidebar-state.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        if (raw && typeof raw.width === "number") {
          this.state.width = this.clamp(raw.width);
        }
      }
    } catch {
      this.state = { width: DEFAULT_WIDTH };
    }
  }

  private clamp(width: number): number {
    if (!Number.isFinite(width)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[SidebarState] save error:", e);
    }
  }

  getWidth(): number {
    return this.state.width;
  }

  setWidth(width: number): void {
    this.state.width = this.clamp(width);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 250);
  }
}

export const sidebarStateManager = new SidebarStateManager();
