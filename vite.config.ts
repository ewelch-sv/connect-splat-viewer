import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function applyCors(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((_req, res, next) => {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }
    next();
  });
}

function serveManifest(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((req, res, next) => {
    const pathname = req.url?.split("?")[0] ?? "";
    if (pathname !== "/manifest.json") {
      next();
      return;
    }
    const host = req.headers.host ?? "localhost:5173";
    const forwarded = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : host;
    const protoHeader = req.headers["x-forwarded-proto"];
    const proto =
      typeof protoHeader === "string"
        ? protoHeader
        : forwarded.includes("localhost") || forwarded.startsWith("127.")
          ? "http"
          : "https";
    const origin = (process.env.VITE_PUBLIC_BASE_URL || `${proto}://${forwarded}`).replace(/\/$/, "");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(buildManifest(origin));
  });
}

function buildManifest(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${JSON.stringify(
    {
      title: "Gaussian Splats",
      description: "View 3D Gaussian splat PLY files from this Trimble Connect project",
      url: `${base}/`,
      icon: `${base}/icon.svg`,
      infoUrl: `${base}/`,
      extensionType: ["project"],
      enabled: true,
    },
    null,
    2,
  )}\n`;
}

function extensionManifest(): Plugin {
  return {
    name: "extension-manifest",
    configureServer(server) {
      serveManifest(server);
    },
    configurePreviewServer(server) {
      serveManifest(server);
    },
    closeBundle() {
      const origin = (process.env.VITE_PUBLIC_BASE_URL || "").replace(/\/$/, "");
      if (!origin) {
        return;
      }
      fs.writeFileSync(path.join("dist", "manifest.json"), buildManifest(origin));
    },
  };
}

function attachDownloadProxy(server: ViteDevServer | PreviewServer): void {
  applyCors(server);
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/download-proxy")) {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const incoming = new URL(req.url, "http://localhost");
      const target = incoming.searchParams.get("url");
      if (!target || !/^https?:\/\//i.test(target)) {
        res.statusCode = 400;
        res.end("Missing or invalid url");
        return;
      }
      const headers: Record<string, string> = {};
      const auth = req.headers.authorization;
      if (auth) {
        headers.Authorization = auth;
      }
      const upstream = await fetch(target, { headers });
      res.statusCode = upstream.status;
      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      const length = upstream.headers.get("content-length");
      if (length) {
        res.setHeader("Content-Length", length);
      }
      if (!upstream.body) {
        res.end();
        return;
      }
      Readable.fromWeb(upstream.body as never).pipe(res);
    } catch (error) {
      res.statusCode = 502;
      res.end(error instanceof Error ? error.message : "Proxy failed");
    }
  });
}

/** Same-origin download proxy for signed Connect URLs that omit CORS headers. */
function downloadProxy(): Plugin {
  return {
    name: "download-proxy",
    configureServer(server) {
      attachDownloadProxy(server);
    },
    configurePreviewServer(server) {
      attachDownloadProxy(server);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [extensionManifest(), downloadProxy()],
  server: {
    port: 5173,
    cors: true,
  },
  preview: {
    port: 4173,
    cors: true,
  },
  build: {
    sourcemap: true,
  },
});
