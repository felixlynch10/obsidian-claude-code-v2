import { App, Modal, Setting } from "obsidian";
import type { ToolApprovalInfo } from "./types";

/**
 * Modal that shows tool approval details with Approve/Deny buttons.
 * For Edit/Write tools, shows a diff preview. For Bash, shows the command.
 */
export class ToolApprovalModal extends Modal {
  private info: ToolApprovalInfo;
  private resolvePromise: (result: { approved: boolean; alwaysAllow: boolean }) => void;
  private resolved = false;
  private alwaysAllow = false;

  constructor(
    app: App,
    info: ToolApprovalInfo,
    resolvePromise: (result: { approved: boolean; alwaysAllow: boolean }) => void
  ) {
    super(app);
    this.info = info;
    this.resolvePromise = resolvePromise;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("tool-approval-modal");

    // Title
    contentEl.createEl("h3", {
      text: `Claude wants to use: ${this.info.toolName}`,
      cls: "tool-approval-title",
    });

    // Description
    contentEl.createEl("p", {
      text: this.info.description,
      cls: "tool-approval-description",
    });

    // Tool-specific details
    if (this.info.command) {
      // Bash command
      const codeBlock = contentEl.createDiv({ cls: "tool-approval-command-block" });
      codeBlock.createEl("div", { text: "Command:", cls: "tool-approval-label" });
      const pre = codeBlock.createEl("pre");
      pre.createEl("code", { text: this.info.command });
    }

    if (this.info.filePath) {
      contentEl.createEl("div", {
        text: `File: ${this.info.filePath}`,
        cls: "tool-approval-file-path",
      });
    }

    // If we have diff content (old/new), show it
    if (this.info.oldContent && this.info.newContent) {
      this.renderDiff(contentEl, this.info.oldContent, this.info.newContent);
    }

    // Raw output preview (collapsible)
    const details = contentEl.createEl("details", { cls: "tool-approval-raw" });
    details.createEl("summary", { text: "Show raw output" });
    const rawPre = details.createEl("pre");
    rawPre.createEl("code", {
      text: this.info.rawOutput.slice(0, 2000),
    });

    // Always allow checkbox
    new Setting(contentEl)
      .setName(`Always allow ${this.info.toolName} this session`)
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          this.alwaysAllow = value;
        })
      );

    // Buttons
    const buttonRow = contentEl.createDiv({ cls: "tool-approval-buttons" });

    const denyBtn = buttonRow.createEl("button", {
      text: "Deny",
      cls: "tool-approval-btn tool-approval-btn-deny",
    });
    denyBtn.addEventListener("click", () => {
      this.resolved = true;
      this.resolvePromise({ approved: false, alwaysAllow: false });
      this.close();
    });

    const approveBtn = buttonRow.createEl("button", {
      text: "Approve",
      cls: "tool-approval-btn tool-approval-btn-approve",
    });
    approveBtn.addEventListener("click", () => {
      this.resolved = true;
      this.resolvePromise({ approved: true, alwaysAllow: this.alwaysAllow });
      this.close();
    });

    // Focus approve button by default
    approveBtn.focus();
  }

  onClose(): void {
    if (!this.resolved) {
      // User closed modal without choosing — treat as deny
      this.resolvePromise({ approved: false, alwaysAllow: false });
    }
    this.contentEl.empty();
  }

  private renderDiff(container: HTMLElement, oldContent: string, newContent: string): void {
    const diffContainer = container.createDiv({ cls: "tool-approval-diff" });
    diffContainer.createEl("div", { text: "Changes:", cls: "tool-approval-label" });

    const diffView = diffContainer.createDiv({ cls: "diff-view" });

    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    // Simple line-by-line diff display
    for (const line of oldLines) {
      const lineEl = diffView.createDiv({ cls: "diff-line diff-remove" });
      lineEl.setText("- " + line);
    }
    for (const line of newLines) {
      const lineEl = diffView.createDiv({ cls: "diff-line diff-add" });
      lineEl.setText("+ " + line);
    }
  }
}

/**
 * Show a tool approval modal and return a promise.
 */
export function showToolApprovalModal(
  app: App,
  info: ToolApprovalInfo
): Promise<{ approved: boolean; alwaysAllow: boolean }> {
  return new Promise((resolve) => {
    const modal = new ToolApprovalModal(app, info, resolve);
    modal.open();
  });
}
