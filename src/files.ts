export interface Region {
  isMaster?: boolean;
  origin?: string;
  location?: string;
  serviceRegion?: string;
  "tc-api"?: string;
  tcApi?: string;
}

export interface ProjectDetails {
  id: string;
  name?: string;
  location?: string;
  rootId?: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  type: "FILE" | "FOLDER";
  size?: number;
  versionId?: string;
  parentId?: string;
  pathLabel: string;
}

const MASTER_API = "https://app.connect.trimble.com/tc/api/2.0/";
const SPLAT_EXTENSIONS = [".ply", ".spz", ".splat", ".ksplat", ".sog"];
const LARGE_FILE_BYTES = 150 * 1024 * 1024;

export function isSplatFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return SPLAT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isPlyFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".ply");
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || Number.isNaN(bytes)) {
    return "Unknown size";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function isLargeFile(bytes: number | undefined): boolean {
  return (bytes ?? 0) >= LARGE_FILE_BYTES;
}

function apiRoot(region: Region | undefined): string {
  const value = region?.["tc-api"] ?? region?.tcApi ?? MASTER_API;
  return value.endsWith("/") ? value : `${value}/`;
}

async function apiGet<T>(url: string, token: string, extraHeaders?: HeadersInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...extraHeaders,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  if (response.status === 204) {
    return [] as T;
  }
  return (await response.json()) as T;
}

export async function loadRegions(token: string): Promise<Region[]> {
  return apiGet<Region[]>(`${MASTER_API}regions`, token);
}

export function regionForLocation(regions: Region[], location?: string): Region {
  if (location) {
    const match = regions.find(
      (region) => region.location?.toLowerCase() === location.toLowerCase(),
    );
    if (match) {
      return match;
    }
  }
  return regions.find((region) => region.isMaster) ?? regions[0];
}

export async function loadProjectDetails(
  token: string,
  projectId: string,
  location?: string,
): Promise<{ project: ProjectDetails; region: Region }> {
  const regions = await loadRegions(token);
  let region = regionForLocation(regions, location);
  try {
    const project = await apiGet<ProjectDetails>(`${apiRoot(region)}projects/${projectId}`, token);
    if (project.location && project.location !== location) {
      region = regionForLocation(regions, project.location);
    }
    return { project, region };
  } catch {
    for (const candidate of regions) {
      try {
        const project = await apiGet<ProjectDetails>(
          `${apiRoot(candidate)}projects/${projectId}`,
          token,
        );
        return { project, region: candidate };
      } catch {
        /* try the next region */
      }
    }
    throw new Error("Could not load project details from any Connect region");
  }
}

function asFileArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["items", "files", "data", "results"]) {
      if (Array.isArray(record[key])) {
        return record[key] as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

function toProjectFile(item: Record<string, unknown>, pathLabel: string): ProjectFile {
  return {
    id: String(item.id ?? ""),
    name: String(item.name ?? "Untitled"),
    type: item.type === "FOLDER" ? "FOLDER" : "FILE",
    size: typeof item.size === "number" ? item.size : undefined,
    versionId: item.versionId ? String(item.versionId) : undefined,
    parentId: item.parentId ? String(item.parentId) : undefined,
    pathLabel,
  };
}

async function searchPlyFiles(
  token: string,
  tcApi: string,
  projectId: string,
): Promise<ProjectFile[] | null> {
  const query = encodeURIComponent(".ply");
  const url = `${tcApi}search?q=${query}&projectId=${encodeURIComponent(projectId)}&type=FILE`;
  try {
    const payload = await apiGet<unknown>(url, token, { Range: "items=0-499" });
    const files = asFileArray(payload)
      .map((item) => {
        const pathParts = Array.isArray(item.path)
          ? (item.path as Array<{ name?: string }>).map((part) => part.name).filter(Boolean)
          : [];
        const name = String(item.name ?? "");
        const pathLabel = pathParts.length ? `${pathParts.join("/")} / ${name}` : name;
        return toProjectFile(item, pathLabel);
      })
      .filter((file) => file.id && isPlyFilename(file.name));
    return files;
  } catch {
    return null;
  }
}

async function listFolder(
  token: string,
  tcApi: string,
  folderId: string,
): Promise<Array<Record<string, unknown>>> {
  const payload = await apiGet<unknown>(`${tcApi}folders/${folderId}/items`, token);
  return asFileArray(payload);
}

async function walkPlyFiles(
  token: string,
  tcApi: string,
  rootId: string,
): Promise<ProjectFile[]> {
  const found: ProjectFile[] = [];
  const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: "" }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const batch = queue.splice(0, 8);
    const results = await Promise.all(
      batch.map(async (folder) => {
        if (seen.has(folder.id)) {
          return [] as Array<{ item: Record<string, unknown>; path: string }>;
        }
        seen.add(folder.id);
        const items = await listFolder(token, tcApi, folder.id);
        return items.map((item) => ({ item, path: folder.path }));
      }),
    );

    for (const entries of results) {
      for (const { item, path } of entries) {
        const name = String(item.name ?? "");
        const type = item.type === "FOLDER" ? "FOLDER" : "FILE";
        const nextPath = path ? `${path} / ${name}` : name;
        if (type === "FOLDER" && item.id) {
          queue.push({ id: String(item.id), path: nextPath });
        } else if (isPlyFilename(name) && item.id) {
          found.push(toProjectFile(item, nextPath));
        }
      }
    }
  }

  found.sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
  return found;
}

export async function listPlyFiles(
  token: string,
  project: ProjectDetails,
  region: Region,
): Promise<ProjectFile[]> {
  const tcApi = apiRoot(region);
  const searched = await searchPlyFiles(token, tcApi, project.id);
  if (searched && searched.length > 0) {
    return searched.sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
  }
  if (!project.rootId) {
    return searched ?? [];
  }
  return walkPlyFiles(token, tcApi, project.rootId);
}

async function fetchWithProgress(
  url: string,
  headers: HeadersInit,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Blob> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const total = Number(response.headers.get("content-length")) || null;
  if (!response.body || !onProgress) {
    return response.blob();
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks);
}

function proxyUrl(target: string): string {
  const base = import.meta.env.VITE_DOWNLOAD_PROXY || "/download-proxy";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}url=${encodeURIComponent(target)}`;
}

export async function downloadFileBlob(
  token: string,
  region: Region,
  file: ProjectFile,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Blob> {
  const tcApi = apiRoot(region);
  const payload = await apiGet<{ url?: string } | string>(
    `${tcApi}files/fs/${file.id}/downloadurl`,
    token,
  );
  const signedUrl = typeof payload === "string" ? payload : payload.url;
  if (!signedUrl) {
    throw new Error("Connect did not return a download URL");
  }

  const attempts: Array<{ url: string; headers: HeadersInit }> = [
    { url: signedUrl, headers: {} },
    { url: signedUrl, headers: { Authorization: `Bearer ${token}` } },
    { url: proxyUrl(signedUrl), headers: { Authorization: `Bearer ${token}` } },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await fetchWithProgress(attempt.url, attempt.headers, onProgress);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not download the file (CORS or network error)");
}
