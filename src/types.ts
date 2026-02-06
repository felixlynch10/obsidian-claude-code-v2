export interface ToolApprovalInfo {
  toolName: string;
  description: string;
  filePath?: string;
  command?: string;
  oldContent?: string;
  newContent?: string;
  rawOutput: string;
}

export interface SessionEntry {
  sessionId: string;
  fullPath: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  projectPath: string;
  isSidechain: boolean;
  gitBranch?: string;
}

export interface SessionIndex {
  version: number;
  entries: SessionEntry[];
  originalPath: string;
}
