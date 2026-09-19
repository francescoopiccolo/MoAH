export interface ToolInfo {
  name: string;
  description: string;
  parameters?: unknown;
  promptGuidelines?: string[];
  sourceInfo?: { path?: string };
}

export interface ExtensionUIContext {
  setStatus(key: string, text: string | undefined): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface ExtensionContext {
  ui: ExtensionUIContext;
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;
  cwd: string;
}

export interface ExtensionAPI {
  registerTool(tool: any): void;
  registerCommand(name: string, options: any): void;
  on(event: string, handler: (event: any, ctx: any) => unknown): void;
  getAllTools(): ToolInfo[];
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}

export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
