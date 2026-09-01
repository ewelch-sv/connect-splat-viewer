# Trimble Connect Gaussian Splat Viewer

A **Trimble Connect for Browser** project extension that lists `.ply` Gaussian splat files in the current project and renders them in a WebGL viewer.

The native Connect 3D Viewer cannot display 3D Gaussian Splatting. This app runs in Connect’s extension iframe and uses [Spark](https://github.com/sparkjsdev/spark) + Three.js.

## Local demo (no Connect)

```bash
npm install
npm run dev
```

Open http://localhost:5173. Use **Open local PLY** with a 3DGS `.ply`, or **Load sample** for a public Spark splat.

A mesh or point-cloud `.ply` (for example a SiteVision / MeshLab export) will be rejected. Gaussian splat PLYs include properties such as `scale_0`, `rot_0`, `f_dc_0`, and `opacity`.

## Install in Trimble Connect

1. Host this app on HTTPS with CORS enabled on the manifest (GitHub Pages, Netlify, or `npm run build` behind any static host).
2. Confirm `dist/manifest.json` (or `/manifest.json`) has absolute `url` and `icon` values for that host. GitHub Actions sets `VITE_PUBLIC_BASE_URL` automatically. For a manual build:

   ```bash
   set VITE_PUBLIC_BASE_URL=https://your-host.example
   npm run build
   ```

3. As a **project admin**, open the project in Trimble Connect for Browser.
4. Go to **Settings → Apps & Capabilities → + Add Custom**.
5. Paste the manifest URL, for example `https://your-host.example/manifest.json`.
6. Enable the extension. It appears in the **left navigation** as **Gaussian Splats**.
7. Open it and accept the access-token prompt so the extension can list and download project files.

Install this on a **test project** first. The extension is read-only (list + download). After consent it holds the signed-in user’s Trimble Identity token in the page — do not host the app on an untrusted origin.

Browser project extensions and 3D Viewer extensions are independent. This v1 is `extensionType: ["project"]` only.

## File download and CORS

Connect download URLs are short-lived signed links. If the browser cannot fetch them because of CORS, the app retries through `/download-proxy`:

- **Vite dev/preview:** built-in middleware in `vite.config.ts`
- **Netlify:** `netlify/functions/download.js` redirected from `/download-proxy`

GitHub Pages is static-only. If downloads fail there, deploy to Netlify or another host that can run the proxy.

## Layout

```
src/connect.ts   Workspace API, menu, token consent, current project
src/files.ts     Regional Core API: search/list, downloadurl, blob fetch
src/ply.ts       3DGS PLY header check
src/viewer.ts    Spark + Three.js orbit viewer
src/main.ts      File picker UI
public/manifest.json
```

## Docs

- [Extend Trimble Connect](https://developer.trimble.com/docs/connect/guides/extend/)
- [Workspace API](https://components.connect.trimble.com/trimble-connect-workspace-api/index.html)
- [Connect Core API](https://developer.trimble.com/docs/connect/tools/api/core/)
