import { App, PluginSettingTab, Setting } from "obsidian";
import type ClaudeCodePlugin from "./main";

export interface ClaudeCodeSettings {
  claudePath: string;
  pythonPath: string;
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  autoApproveReadOnly: boolean;
}

export const DEFAULT_SETTINGS: ClaudeCodeSettings = {
  claudePath: "/Users/fellync/.local/bin/claude",
  pythonPath: "python3",
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  cursorBlink: true,
  autoApproveReadOnly: true,
};

export class ClaudeCodeSettingTab extends PluginSettingTab {
  plugin: ClaudeCodePlugin;

  constructor(app: App, plugin: ClaudeCodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Claude Code Sidebar v2 Settings" });

    new Setting(containerEl)
      .setName("Claude CLI path")
      .setDesc("Absolute path to the claude CLI binary")
      .addText((text) =>
        text
          .setPlaceholder("/Users/fellync/.local/bin/claude")
          .setValue(this.plugin.settings.claudePath)
          .onChange(async (value) => {
            this.plugin.settings.claudePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Python 3 path")
      .setDesc("Path to python3 binary (needed for PTY helper)")
      .addText((text) =>
        text
          .setPlaceholder("python3")
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (value) => {
            this.plugin.settings.pythonPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Terminal font size in pixels")
      .addSlider((slider) =>
        slider
          .setLimits(10, 24, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
            this.plugin.updateTerminalSettings();
          })
      );

    new Setting(containerEl)
      .setName("Font family")
      .setDesc("Terminal font family (CSS font-family value)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.fontFamily)
          .onChange(async (value) => {
            this.plugin.settings.fontFamily = value;
            await this.plugin.saveSettings();
            this.plugin.updateTerminalSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cursor blink")
      .setDesc("Whether the terminal cursor blinks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.cursorBlink)
          .onChange(async (value) => {
            this.plugin.settings.cursorBlink = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Tool Approval" });

    new Setting(containerEl)
      .setName("Auto-approve read-only tools")
      .setDesc(
        "Automatically approve Read, Glob, Grep, WebSearch, and WebFetch without showing a modal"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoApproveReadOnly)
          .onChange(async (value) => {
            this.plugin.settings.autoApproveReadOnly = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
