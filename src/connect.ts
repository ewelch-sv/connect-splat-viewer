import * as WorkspaceAPI from "trimble-connect-workspace-api";
import type { WorkspaceAPI as WorkspaceApiType, WorkspaceEventCallback } from "trimble-connect-workspace-api";

export const MENU_COMMAND = "splat.home";

export type PermissionStatus = "pending" | "denied";

type EventPayload = { data?: unknown } | string | unknown;

export interface ConnectProjectInfo {
  id: string;
  name?: string;
  location?: string;
  rootId?: string;
}

function extractEventData(payload: EventPayload): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data?: unknown }).data;
  }
  return payload;
}

function isLiveToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 20 && value !== "pending" && value !== "denied";
}

export function isEmbeddedInConnect(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

export class ConnectSession {
  api: WorkspaceApiType | null = null;
  token: string | null = null;
  permission: PermissionStatus | "granted" | "idle" = "idle";
  project: ConnectProjectInfo | null = null;
  onChange: (() => void) | null = null;

  private tokenResolvers: Array<(token: string) => void> = [];

  private notify(): void {
    this.onChange?.();
  }

  private setToken(token: string): void {
    this.token = token;
    this.permission = "granted";
    const waiting = this.tokenResolvers.splice(0);
    for (const resolve of waiting) {
      resolve(token);
    }
    this.notify();
  }

  private onEvent(event: string, payload: EventPayload): void {
    const data = extractEventData(payload);
    if (event === "extension.accessToken") {
      if (data === "denied") {
        this.permission = "denied";
        this.notify();
        return;
      }
      if (data === "pending") {
        this.permission = "pending";
        this.notify();
        return;
      }
      if (isLiveToken(data)) {
        this.setToken(data);
      }
    }
  }

  async connect(): Promise<void> {
    this.api = await WorkspaceAPI.connect(
      window.parent,
      ((event: string, payload: EventPayload) => this.onEvent(event, payload)) as WorkspaceEventCallback,
      30000,
    );

    const icon = new URL("icon.svg", window.location.href).href;
    await this.api.ui.setMenu({
      title: "Gaussian Splats",
      icon,
      command: MENU_COMMAND,
      subMenus: [],
    });

    const result = await this.api.extension.requestPermission("accesstoken");
    if (result === "denied") {
      this.permission = "denied";
    } else if (result === "pending") {
      this.permission = "pending";
    } else if (isLiveToken(result)) {
      this.setToken(result);
    }
    this.notify();
  }

  waitForToken(): Promise<string> {
    if (this.token) {
      return Promise.resolve(this.token);
    }
    return new Promise((resolve) => {
      this.tokenResolvers.push(resolve);
    });
  }

  async loadProject(): Promise<ConnectProjectInfo> {
    if (!this.api) {
      throw new Error("Workspace API is not connected");
    }
    const project = await this.api.project.getProject();
    if (!project?.id) {
      throw new Error("Could not read the current Trimble Connect project");
    }
    this.project = project;
    this.notify();
    return project;
  }
}
