import type { ToolApprovalInfo } from "./types";

/**
 * Monitors PTY output for Claude Code tool approval prompts.
 *
 * Claude Code's interactive permission prompts end with a line like:
 *   "Allow ... ? (Y)es / (N)o / Yes, and don't ask again for ..."
 *
 * We detect this pattern in the raw (ANSI-included) terminal output,
 * buffer the approval block, parse tool info, and fire a callback
 * so the UI can show a modal. The response (y/n) is then injected
 * back into the PTY stdin.
 */
export class ToolApprovalMonitor {
  private buffer = "";
  private isBuffering = false;
  private pendingResolve: ((approved: boolean) => void) | null = null;
  private onToolApproval: (info: ToolApprovalInfo) => Promise<boolean>;
  private writeToStdin: (data: string) => void;
  private writeToTerminal: (data: Buffer | string) => void;

  // Pattern that marks the END of a permission prompt
  // Claude Code always shows "(Y)es" and "(N)o" in the approval line
  private static APPROVAL_PATTERN = /\(Y\)es\s*\/?\s*\(N\)o/;

  // Pattern to detect the start of a permission block
  // Claude Code shows "Allow <tool>" or similar before the Y/N prompt
  private static TOOL_BLOCK_START = /(?:Allow|allow)\s+(\w+)/;

  constructor(
    onToolApproval: (info: ToolApprovalInfo) => Promise<boolean>,
    writeToStdin: (data: string) => void,
    writeToTerminal: (data: Buffer | string) => void
  ) {
    this.onToolApproval = onToolApproval;
    this.writeToStdin = writeToStdin;
    this.writeToTerminal = writeToTerminal;
  }

  /**
   * Process incoming PTY output data.
   * Returns the data to write to the terminal, or null if buffering.
   */
  processData(data: Buffer): void {
    const text = data.toString("utf-8");

    if (this.isBuffering) {
      // Already buffering a potential approval block
      this.buffer += text;
      this.checkBuffer();
      return;
    }

    // Check if this chunk contains the start of an approval prompt
    const stripped = this.stripAnsi(text);

    if (ToolApprovalMonitor.TOOL_BLOCK_START.test(stripped)) {
      // Might be the start of an approval block — start buffering
      this.isBuffering = true;
      this.buffer = text;
      this.checkBuffer();
      return;
    }

    // No approval pattern detected, pass through normally
    this.writeToTerminal(data);
  }

  private checkBuffer(): void {
    const stripped = this.stripAnsi(this.buffer);

    // Check if we have a complete approval prompt
    if (ToolApprovalMonitor.APPROVAL_PATTERN.test(stripped)) {
      // We have a complete approval prompt — parse and show modal
      this.isBuffering = false;
      const info = this.parseToolInfo(stripped);

      // Write the buffered content to terminal so user can see what Claude wants
      this.writeToTerminal(this.buffer);
      this.buffer = "";

      // Show approval modal
      this.onToolApproval(info).then((approved) => {
        this.writeToStdin(approved ? "y" : "n");
      });
      return;
    }

    // Check if buffer is getting too large without finding the pattern
    // This means the "Allow" text was a false positive (e.g., in normal conversation)
    if (stripped.length > 3000 || this.countNewlines(stripped) > 30) {
      // Flush buffer as normal output — it wasn't an approval prompt
      this.isBuffering = false;
      this.writeToTerminal(this.buffer);
      this.buffer = "";
    }
  }

  /**
   * Parse tool name and details from the approval prompt text.
   */
  private parseToolInfo(text: string): ToolApprovalInfo {
    const info: ToolApprovalInfo = {
      toolName: "Unknown",
      description: "",
      rawOutput: text,
    };

    // Extract tool name from "Allow <ToolName>" pattern
    const toolMatch = text.match(/(?:Allow|allow)\s+(\w+)/);
    if (toolMatch) {
      info.toolName = toolMatch[1];
    }

    // Extract file path if present (common in Read/Write/Edit)
    const pathMatch = text.match(/(?:file_path|path)[:\s]+["']?([^\s"'\n]+)/i);
    if (pathMatch) {
      info.filePath = pathMatch[1];
    }

    // Extract command if Bash tool
    if (info.toolName === "Bash" || info.toolName === "bash") {
      const cmdMatch = text.match(/(?:command)[:\s]+["']?(.+?)["']?\s*(?:\n|$)/i);
      if (cmdMatch) {
        info.command = cmdMatch[1].trim();
      }
    }

    // Build description
    if (info.command) {
      info.description = `Run command: ${info.command}`;
    } else if (info.filePath) {
      info.description = `${info.toolName} ${info.filePath}`;
    } else {
      info.description = `Use tool: ${info.toolName}`;
    }

    return info;
  }

  /**
   * Strip ANSI escape sequences from text for pattern matching.
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
               .replace(/\x1b\][^\x07]*\x07/g, "")
               .replace(/\x1b[()][0-9A-B]/g, "");
  }

  private countNewlines(text: string): number {
    let count = 0;
    for (const ch of text) {
      if (ch === "\n") count++;
    }
    return count;
  }

  /**
   * Reset the monitor state (e.g., when restarting the session).
   */
  reset(): void {
    if (this.isBuffering) {
      // Flush any remaining buffer
      this.writeToTerminal(this.buffer);
    }
    this.buffer = "";
    this.isBuffering = false;
    this.pendingResolve = null;
  }
}
