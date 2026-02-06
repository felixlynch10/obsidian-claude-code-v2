import { Plugin, WorkspaceLeaf } from "obsidian";
import { ClaudeCodeView } from "./claude-code-view";
import {
  ClaudeCodeSettings,
  DEFAULT_SETTINGS,
  ClaudeCodeSettingTab,
} from "./settings";
import { VIEW_TYPE_CLAUDE_CODE, ICON_NAME } from "./constants";

export default class ClaudeCodePlugin extends Plugin {
  settings: ClaudeCodeSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_CLAUDE_CODE,
      (leaf: WorkspaceLeaf) => new ClaudeCodeView(leaf, this)
    );

    this.addRibbonIcon(ICON_NAME, "Open Claude Code", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-claude-code-sidebar",
      name: "Open Claude Code sidebar",
      callback: () => {
        this.activateView();
      },
    });

    this.addCommand({
      id: "restart-claude-code",
      name: "Restart Claude Code session",
      callback: () => {
        this.restartSession();
      },
    });

    this.addCommand({
      id: "new-claude-code-chat",
      name: "New Claude Code chat",
      callback: () => {
        const view = this.getActiveView();
        if (view) {
          view.startNewChat();
        } else {
          this.activateView();
        }
      },
    });

    this.addCommand({
      id: "browse-claude-code-sessions",
      name: "Browse Claude Code sessions",
      callback: async () => {
        const view = this.getActiveView();
        if (view) {
          await view.openSessionPicker();
        } else {
          await this.activateView();
          // Give the view time to initialize
          setTimeout(() => {
            const v = this.getActiveView();
            if (v) v.openSessionPicker();
          }, 500);
        }
      },
    });

    this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));
  }

  private getActiveView(): ClaudeCodeView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);
    if (leaves.length > 0) {
      const view = leaves[0].view;
      if (view instanceof ClaudeCodeView) {
        return view;
      }
    }
    return null;
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);

    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    const rightLeaf = workspace.getRightLeaf(false);
    if (rightLeaf) {
      await rightLeaf.setViewState({
        type: VIEW_TYPE_CLAUDE_CODE,
        active: true,
      });
      workspace.revealLeaf(rightLeaf);
    }
  }

  async restartSession(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);
    for (const leaf of leaves) {
      leaf.detach();
    }
    await this.activateView();
  }

  updateTerminalSettings(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof ClaudeCodeView) {
        view.updateSettings();
      }
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
