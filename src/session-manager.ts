import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { SessionEntry, SessionIndex } from "./types";

/**
 * Manages Claude Code sessions for a specific vault/project.
 * Reads from ~/.claude/projects//<encoded-path>/sessions-index.json
 */
export class SessionManager {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Encode a vault path to the Claude project directory name.
   * /Users/fellync/vaults/Felix School → -Users-fellync-vaults-Felix-School
   */
  private encodeProjectPath(vaultPath: string): string {
    return vaultPath.replace(/\//g, "-");
  }

  /**
   * Get the path to the sessions directory for this vault.
   */
  getSessionDir(): string {
    const encoded = this.encodeProjectPath(this.vaultPath);
    // Note: Claude uses a double slash in the projects directory
    return path.join(os.homedir(), ".claude", "projects", "", encoded);
  }

  /**
   * Get the path to the sessions index file.
   */
  private getSessionsIndexPath(): string {
    return path.join(this.getSessionDir(), "sessions-index.json");
  }

  /**
   * List all sessions for this vault, sorted by modified date (newest first).
   */
  async listSessions(): Promise<SessionEntry[]> {
    const indexPath = this.getSessionsIndexPath();

    try {
      const content = fs.readFileSync(indexPath, "utf-8");
      const index: SessionIndex = JSON.parse(content);

      if (!index.entries || !Array.isArray(index.entries)) {
        return [];
      }

      // Sort by modified date, newest first
      return index.entries
        .filter((e) => !e.isSidechain)
        .sort((a, b) => {
          const dateA = new Date(a.modified).getTime();
          const dateB = new Date(b.modified).getTime();
          return dateB - dateA;
        });
    } catch {
      // File doesn't exist or is invalid
      return [];
    }
  }

  /**
   * Delete a session by removing its .jsonl file and updating the index.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const indexPath = this.getSessionsIndexPath();

    try {
      const content = fs.readFileSync(indexPath, "utf-8");
      const index: SessionIndex = JSON.parse(content);

      // Find and remove the entry
      const entryIndex = index.entries.findIndex(
        (e) => e.sessionId === sessionId
      );
      if (entryIndex === -1) return;

      const entry = index.entries[entryIndex];

      // Delete the .jsonl file
      try {
        fs.unlinkSync(entry.fullPath);
      } catch {
        // File may already be deleted
      }

      // Also delete the session subdirectory if it exists
      const sessionDir = path.join(
        this.getSessionDir(),
        sessionId
      );
      try {
        fs.rmSync(sessionDir, { recursive: true });
      } catch {
        // Directory may not exist
      }

      // Update the index
      index.entries.splice(entryIndex, 1);
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    } catch {
      // Index file doesn't exist or other error
    }
  }

  /**
   * Format a date string for display.
   */
  static formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Today " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  }
}
