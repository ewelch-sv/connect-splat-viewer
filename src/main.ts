import "./style.css";
import { ConnectSession, isEmbeddedInConnect } from "./connect";
import {
  downloadFileBlob,
  formatBytes,
  isLargeFile,
  listPlyFiles,
  loadProjectDetails,
  type ProjectFile,
  type Region,
} from "./files";
import { inspectPly } from "./ply";
import type { ViewerHandle } from "./viewer";

const SAMPLE_SPLAT = "https://sparkjs.dev/assets/splats/butterfly.spz";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <div class="app">
    <div class="banner" id="banner">Starting…</div>
    <aside class="sidebar">
      <header>
        <h1>Gaussian Splats</h1>
        <p>PLY files from this Trimble Connect project. Mesh PLYs are rejected.</p>
      </header>
      <div class="toolbar">
        <button type="button" id="refresh">Refresh</button>
        <label class="file-button">Open local PLY<input id="local-file" type="file" accept=".ply,.spz,.splat,.ksplat" /></label>
        <button type="button" id="sample">Load sample</button>
      </div>
      <div class="progress" id="progress" hidden></div>
      <div class="file-list" id="files"></div>
    </aside>
    <div class="viewer-wrap" id="viewer"></div>
  </div>
`;

const banner = must("#banner");
const filesEl = must("#files");
const progressEl = must("#progress");
const refreshBtn = must<HTMLButtonElement>("#refresh");
const sampleBtn = must<HTMLButtonElement>("#sample");
const localInput = must<HTMLInputElement>("#local-file");
const viewerEl = must("#viewer");

const session = new ConnectSession();
let viewer: ViewerHandle | null = null;

let region: Region | null = null;
let files: ProjectFile[] = [];
let activeId: string | null = null;
let objectUrl: string | null = null;

function must<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = app!.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing ${selector}`);
  }
  return el;
}

function setBanner(text: string, kind: "" | "warn" | "danger" = ""): void {
  banner.className = `banner${kind ? ` ${kind}` : ""}`;
  banner.innerHTML = text;
}

async function getViewer(): Promise<ViewerHandle> {
  if (!viewer) {
    viewerEl.textContent = "Loading renderer…";
    const mod = await import("./viewer");
    viewerEl.replaceChildren();
    viewer = mod.createViewer(viewerEl);
  }
  return viewer;
}

function revokeObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function renderFiles(): void {
  if (files.length === 0) {
    filesEl.innerHTML = `<div class="empty">No .ply files found in this project.</div>`;
    return;
  }
  filesEl.replaceChildren(
    ...files.map((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-row${file.id === activeId ? " active" : ""}`;
      button.innerHTML = `<span class="name"></span><span class="meta"></span>`;
      button.querySelector(".name")!.textContent = file.name;
      const warn = isLargeFile(file.size) ? " · large file" : "";
      button.querySelector(".meta")!.textContent = `${file.pathLabel} · ${formatBytes(file.size)}${warn}`;
      button.addEventListener("click", () => {
        void openProjectFile(file);
      });
      return button;
    }),
  );
}

async function loadBlobIntoViewer(blob: Blob, label: string): Promise<void> {
  const check = await inspectPly(blob);
  if (label.toLowerCase().endsWith(".ply") && check.kind !== "gaussian") {
    throw new Error(check.reason);
  }
  revokeObjectUrl();
  objectUrl = URL.createObjectURL(blob);
  const splatViewer = await getViewer();
  splatViewer.setStatus(`Loading ${label}…`);
  await splatViewer.loadFromUrl(objectUrl);
  splatViewer.setStatus(null);
}

async function refreshProjectFiles(): Promise<void> {
  if (!session.token || !session.project) {
    return;
  }
  refreshBtn.disabled = true;
  filesEl.innerHTML = `<div class="empty">Scanning project for .ply files…</div>`;
  try {
    const details = await loadProjectDetails(
      session.token,
      session.project.id,
      session.project.location,
    );
    region = details.region;
    session.project = { ...session.project, ...details.project };
    files = await listPlyFiles(session.token, details.project, details.region);
    setBanner(
      `Project <strong>${escapeHtml(session.project.name ?? session.project.id)}</strong> · ${files.length} PLY file${files.length === 1 ? "" : "s"}`,
    );
    renderFiles();
  } catch (error) {
    filesEl.innerHTML = `<div class="error">${escapeHtml(errorMessage(error))}</div>`;
  } finally {
    refreshBtn.disabled = false;
  }
}

async function openProjectFile(file: ProjectFile): Promise<void> {
  if (!session.token || !region) {
    setBanner("Connect access token is not available yet.", "warn");
    return;
  }
  activeId = file.id;
  renderFiles();
  progressEl.hidden = false;
  progressEl.textContent = `Downloading ${file.name}…`;
  try {
    if (isLargeFile(file.size)) {
      progressEl.textContent = `${file.name} is ${formatBytes(file.size)}. This may be slow or run out of memory.`;
    }
    const blob = await downloadFileBlob(session.token, region, file, (loaded, total) => {
      const pct = total ? ` ${Math.round((loaded / total) * 100)}%` : ` ${formatBytes(loaded)}`;
      progressEl.textContent = `Downloading ${file.name}${pct}`;
    });
    progressEl.textContent = `Validating ${file.name}…`;
    await loadBlobIntoViewer(blob, file.name);
    progressEl.hidden = true;
  } catch (error) {
    progressEl.hidden = true;
    setBanner(escapeHtml(errorMessage(error)), "danger");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

refreshBtn.addEventListener("click", () => {
  void refreshProjectFiles();
});

sampleBtn.addEventListener("click", () => {
  void (async () => {
    try {
      const splatViewer = await getViewer();
      splatViewer.setStatus("Loading sample splat…");
      await splatViewer.loadFromUrl(SAMPLE_SPLAT);
      splatViewer.setStatus(null);
      setBanner("Loaded the public Spark sample splat (not from Connect).");
    } catch (error) {
      setBanner(escapeHtml(errorMessage(error)), "danger");
    }
  })();
});

localInput.addEventListener("change", () => {
  const file = localInput.files?.[0];
  localInput.value = "";
  if (!file) {
    return;
  }
  void (async () => {
    try {
      progressEl.hidden = false;
      progressEl.textContent = `Opening ${file.name}…`;
      await loadBlobIntoViewer(file, file.name);
      progressEl.hidden = true;
      setBanner(`Opened local file <strong>${escapeHtml(file.name)}</strong>`);
    } catch (error) {
      progressEl.hidden = true;
      setBanner(escapeHtml(errorMessage(error)), "danger");
    }
  })();
});

async function start(): Promise<void> {
  if (!isEmbeddedInConnect()) {
    setBanner(
      "Standalone mode. Open a local Gaussian splat <strong>.ply</strong>, or load the sample. Embed this app in Trimble Connect to browse project files.",
      "warn",
    );
    filesEl.innerHTML = `<div class="empty">Not running inside Trimble Connect. Use Open local PLY to verify the viewer.</div>`;
    return;
  }

  setBanner("Connecting to Trimble Connect…");
  try {
    await session.connect();
  } catch (error) {
    setBanner(
      `Could not connect to the Workspace API. ${escapeHtml(errorMessage(error))}`,
      "danger",
    );
    return;
  }

  session.onChange = () => {
    if (session.permission === "denied") {
      setBanner(
        "Access token was denied. Enable it in Project Settings → Apps &amp; Capabilities.",
        "danger",
      );
    } else if (session.permission === "pending") {
      setBanner("Waiting for access-token consent in Trimble Connect…", "warn");
    }
  };

  if (session.permission === "denied") {
    session.onChange();
    return;
  }

  try {
    await session.loadProject();
    if (!session.token) {
      setBanner("Waiting for access-token consent in Trimble Connect…", "warn");
      await session.waitForToken();
    }
    await refreshProjectFiles();
  } catch (error) {
    setBanner(escapeHtml(errorMessage(error)), "danger");
  }
}

void start();
