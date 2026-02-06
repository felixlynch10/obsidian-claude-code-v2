import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import * as child_process from "child_process";
import * as path from "path";
import type { Writable } from "stream";
import type ClaudeCodePlugin from "./main";
import { VIEW_TYPE_CLAUDE_CODE, ICON_NAME, DISPLAY_NAME } from "./constants";
import { ToolApprovalMonitor } from "./tool-approval-monitor";
import { showToolApprovalModal } from "./tool-approval-modal";
import { SessionManager } from "./session-manager";
import { showSessionPicker } from "./session-picker-modal";
import type { ToolApprovalInfo } from "./types";

export class ClaudeCodeView extends ItemView {
  plugin: ClaudeCodePlugin;
  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ptyProcess: child_process.ChildProcess | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private toolMonitor: ToolApprovalMonitor | null = null;
  private sessionManager: SessionManager | null = null;
  private currentSessionId: string | null = null;
  private sessionAutoApproved: Set<string> = new Set();
  private sessionLabel: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDE_CODE;
  }

  getDisplayText(): string {
    return DISPLAY_NAME;
  }

  getIcon(): string {
    return ICON_NAME;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("claude-code-terminal-container");

    const vaultBasePath = (this.app.vault.adapter as any).basePath as string;
    this.sessionManager = new SessionManager(vaultBasePath);

    // Header bar with session controls
    const header = contentEl.createDiv({ cls: "claude-code-header" });

    const newChatBtn = header.createEl("button", {
      cls: "claude-code-header-btn clickable-icon",
      attr: { "aria-label": "New chat" },
    });
    setIcon(newChatBtn, "plus");
    newChatBtn.addEventListener("click", () => this.startNewChat());

    const sessionsBtn = header.createEl("button", {
      cls: "claude-code-header-btn clickable-icon",
      attr: { "aria-label": "Browse sessions" },
    });
    setIcon(sessionsBtn, "history");
    sessionsBtn.addEventListener("click", () => this.openSessionPicker());

    this.sessionLabel = header.createEl("span", {
      text: "New session",
      cls: "claude-code-session-label",
    });

    // Terminal wrapper
    const terminalWrapper = contentEl.createDiv({
      cls: "claude-code-terminal-wrapper",
    });

    const { settings } = this.plugin;
    this.term = new Terminal({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      cursorBlink: settings.cursorBlink,
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
    });

    this.applyObsidianTheme();

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());

    this.term.open(terminalWrapper);

    requestAnimationFrame(() => {
      this.fitAddon?.fit();
      this.spawnPtyHelper();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.debouncedResize();
    });
    this.resizeObserver.observe(terminalWrapper);

    this.term.onData((data: string) => {
      if (this.ptyProcess?.stdin && !this.ptyProcess.stdin.destroyed) {
        this.ptyProcess.stdin.write(data);
      }
    });

    this.term.onBinary((data: string) => {
      if (this.ptyProcess?.stdin && !this.ptyProcess.stdin.destroyed) {
        const buffer = Buffer.from(data, "binary");
        this.ptyProcess.stdin.write(buffer);
      }
    });
  }

  private applyObsidianTheme(): void {
    if (!this.term) return;
    const style = getComputedStyle(this.contentEl);

    const bg = style.getPropertyValue("--background-primary").trim() || "#1e1e1e";
    const fg = style.getPropertyValue("--text-normal").trim() || "#d4d4d4";
    const cursor = style.getPropertyValue("--text-accent").trim() || "#528bff";

    this.term.options.theme = {
      background: bg,
      foreground: fg,
      cursor: cursor,
      selectionBackground: "rgba(255, 255, 255, 0.15)",
    };
  }

  private spawnPtyHelper(sessionId?: string): void {
    const { settings } = this.plugin;

    const vaultBasePath = (this.app.vault.adapter as any).basePath as string;
    const pluginDir = this.plugin.manifest.dir;
    const ptyHelperPath = path.join(
      vaultBasePath,
      pluginDir || ".obsidian/plugins/obsidian-claude-code-v2",
      "resources",
      "pty-helper.py"
    );

    const claudePath = settings.claudePath;
    const cwd = vaultBasePath;

    // Build the command args for claude
    const claudeArgs = [ptyHelperPath, claudePath];
    if (sessionId) {
      claudeArgs.push("--resume", sessionId);
    }

    // Set up the tool approval monitor
    this.toolMonitor = new ToolApprovalMonitor(
      (info: ToolApprovalInfo) => this.handleToolApproval(info),
      (data: string) => {
        if (this.ptyProcess?.stdin && !this.ptyProcess.stdin.destroyed) {
          this.ptyProcess.stdin.write(data);
        }
      },
      (data: Buffer | string) => {
        this.term?.write(data);
      }
    );

    try {
      this.ptyProcess = child_process.spawn(
        settings.pythonPath,
        claudeArgs,
        {
          cwd: cwd,
          shell: false,
          stdio: ["pipe", "pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PATH: [process.env.HOME + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].join(":"),
            TERM: "xterm-256color",
            FORCE_COLOR: "1",
          },
        }
      );

      // Route stdout through the tool approval monitor
      this.ptyProcess.stdout?.on("data", (data: Buffer) => {
        if (this.toolMonitor) {
          this.toolMonitor.processData(data);
        } else {
          this.term?.write(data);
        }
      });

      this.ptyProcess.stderr?.on("data", (data: Buffer) => {
        this.term?.write(data);
      });

      this.ptyProcess.on("exit", (code: number | null) => {
        this.term?.write(
          `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`
        );
        this.term?.write(
          `\x1b[90mPress any key to restart Claude Code...\x1b[0m\r\n`
        );
        this.ptyProcess = null;
        this.toolMonitor?.reset();

        const disposable = this.term?.onData(() => {
          disposable?.dispose();
          this.spawnPtyHelper();
        });
      });

      this.ptyProcess.on("error", (err: Error) => {
        new Notice(`Claude Code: Failed to start PTY helper: ${err.message}`);
        this.term?.write(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
        if (err.message.includes("ENOENT")) {
          this.term?.write(
            `\x1b[33mCheck that python3 is installed and the path is correct in settings.\x1b[0m\r\n`
          );
        }
      });

      this.currentSessionId = sessionId || null;
      this.sessionAutoApproved.clear();
      this.updateSessionLabel(sessionId ? `Resumed: ${sessionId.slice(0, 8)}...` : "New session");

      this.sendResize();
    } catch (err) {
      new Notice(`Claude Code: ${(err as Error).message}`);
    }
  }

  /**
   * Handle a tool approval request from the monitor.
   */
  private async handleToolApproval(info: ToolApprovalInfo): Promise<boolean> {
    // Auto-approve if tool is in the session's always-allow set
    if (this.sessionAutoApproved.has(info.toolName)) {
      return true;
    }

    // Auto-approve read-only tools if setting is enabled
    const readOnlyTools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
    if (
      this.plugin.settings.autoApproveReadOnly &&
      readOnlyTools.includes(info.toolName)
    ) {
      return true;
    }

    // Show the approval modal
    const result = await showToolApprovalModal(this.app, info);

    if (result.alwaysAllow) {
      this.sessionAutoApproved.add(info.toolName);
    }

    return result.approved;
  }

  /**
   * Start a new Claude Code chat (kill current, spawn fresh).
   */
  startNewChat(): void {
    this.killCurrentProcess();
    this.term?.clear();
    this.spawnPtyHelper();
  }

  /**
   * Open the session picker modal.
   */
  async openSessionPicker(): Promise<void> {
    if (!this.sessionManager) return;

    const sessions = await this.sessionManager.listSessions();
    if (sessions.length === 0) {
      new Notice("No previous sessions found");
      return;
    }

    const sessionId = await showSessionPicker(
      this.app,
      sessions,
      this.sessionManager
    );

    if (sessionId) {
      this.killCurrentProcess();
      this.term?.clear();
      // Update label with session summary
      const session = sessions.find((s) => s.sessionId === sessionId);
      this.spawnPtyHelper(sessionId);
      if (session) {
        this.updateSessionLabel(session.summary || `Session ${sessionId.slice(0, 8)}`);
      }
    }
  }

  private killCurrentProcess(): void {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill("SIGTERM");
        const proc = this.ptyProcess;
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // already exited
          }
        }, 1000);
      } catch {
        // already exited
      }
      this.ptyProcess = null;
    }
    this.toolMonitor?.reset();
  }

  private updateSessionLabel(text: string): void {
    if (this.sessionLabel) {
      this.sessionLabel.setText(text);
    }
  }

  private sendResize(): void {
    if (!this.ptyProcess || !this.term) return;
    const stdio3 = this.ptyProcess.stdio?.[3] as Writable | null;
    if (!stdio3 || stdio3.destroyed) return;

    const rows = this.term.rows;
    const cols = this.term.cols;

    const buffer = Buffer.alloc(8);
    buffer.writeUInt16LE(rows, 0);
    buffer.writeUInt16LE(cols, 2);
    buffer.writeUInt16LE(0, 4);
    buffer.writeUInt16LE(0, 6);

    try {
      stdio3.write(buffer);
    } catch {
      // fd 3 may be closed if process exited
    }
  }

  private debouncedResize(): void {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    this.resizeTimeout = setTimeout(() => {
      this.fitAddon?.fit();
      this.sendResize();
    }, 100);
  }

  updateSettings(): void {
    if (!this.term) return;
    const { settings } = this.plugin;
    this.term.options.fontSize = settings.fontSize;
    this.term.options.fontFamily = settings.fontFamily;
    this.term.options.cursorBlink = settings.cursorBlink;
    this.fitAddon?.fit();
    this.sendResize();
  }

  async onClose(): Promise<void> {
    this.killCurrentProcess();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    if (this.term) {
      this.term.dispose();
      this.term = null;
    }

    this.fitAddon = null;
    this.toolMonitor = null;
  }
}
