import { App, SuggestModal, Notice } from "obsidian";
import type { SessionEntry } from "./types";
import { SessionManager } from "./session-manager";

/**
 * Modal for browsing, selecting, and deleting Claude Code sessions.
 */
export class SessionPickerModal extends SuggestModal<SessionEntry> {
  private sessions: SessionEntry[];
  private sessionManager: SessionManager;
  private resolvePromise: (sessionId: string | null) => void;

  constructor(
    app: App,
    sessions: SessionEntry[],
    sessionManager: SessionManager,
    resolvePromise: (sessionId: string | null) => void
  ) {
    super(app);
    this.sessions = sessions;
    this.sessionManager = sessionManager;
    this.resolvePromise = resolvePromise;
    this.setPlaceholder("Search sessions...");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "resume session" },
      { command: "esc", purpose: "cancel" },
    ]);
  }

  getSuggestions(query: string): SessionEntry[] {
    const lower = query.toLowerCase();
    if (!lower) return this.sessions;

    return this.sessions.filter(
      (s) =>
        s.summary.toLowerCase().includes(lower) ||
        s.firstPrompt.toLowerCase().includes(lower)
    );
  }

  renderSuggestion(entry: SessionEntry, el: HTMLElement): void {
    const container = el.createDiv({ cls: "session-picker-item" });

    // Top row: summary + delete button
    const topRow = container.createDiv({ cls: "session-picker-top-row" });

    topRow.createEl("span", {
      text: entry.summary || "Untitled session",
      cls: "session-picker-summary",
    });

    const deleteBtn = topRow.createEl("button", {
      cls: "session-picker-delete clickable-icon",
      attr: { "aria-label": "Delete session" },
    });
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await this.sessionManager.deleteSession(entry.sessionId);
      // Remove from local list
      const idx = this.sessions.findIndex(
        (s) => s.sessionId === entry.sessionId
      );
      if (idx !== -1) {
        this.sessions.splice(idx, 1);
      }
      new Notice("Session deleted");
      // Refresh the modal
      (this as any).updateSuggestions();
    });

    // Preview row: first prompt (truncated)
    const preview = entry.firstPrompt.slice(0, 100);
    container.createEl("div", {
      text: preview + (entry.firstPrompt.length > 100 ? "..." : ""),
      cls: "session-picker-preview",
    });

    // Meta row: date + message count
    const meta = container.createDiv({ cls: "session-picker-meta" });
    meta.createEl("span", {
      text: SessionManager.formatDate(entry.modified),
    });
    meta.createEl("span", {
      text: `${entry.messageCount} messages`,
    });
  }

  onChooseSuggestion(entry: SessionEntry): void {
    this.resolvePromise(entry.sessionId);
  }

  onClose(): void {
    // If not resolved by selection, resolve with null
    // Use a microtask to allow onChooseSuggestion to fire first
    setTimeout(() => {
      this.resolvePromise(null);
    }, 0);
  }
}

/**
 * Show the session picker and return the selected session ID (or null).
 */
export function showSessionPicker(
  app: App,
  sessions: SessionEntry[],
  sessionManager: SessionManager
): Promise<string | null> {
  let resolved = false;
  return new Promise((resolve) => {
    const wrappedResolve = (id: string | null) => {
      if (!resolved) {
        resolved = true;
        resolve(id);
      }
    };
    const modal = new SessionPickerModal(app, sessions, sessionManager, wrappedResolve);
    modal.open();
  });
}
