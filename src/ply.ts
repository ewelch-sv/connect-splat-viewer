const HEADER_BYTES = 16 * 1024;

const GAUSSIAN_PROPERTIES = [
  "scale_0",
  "rot_0",
  "f_dc_0",
  "opacity",
  "packed_position",
  "sh_dc",
];

export type PlyKind = "gaussian" | "mesh" | "unknown";

export interface PlyCheck {
  kind: PlyKind;
  header: string;
  reason: string;
}

function decodeHeader(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer.slice(0, HEADER_BYTES));
  let end = bytes.length;
  for (let i = 0; i < bytes.length - 10; i += 1) {
    const slice = String.fromCharCode(...bytes.slice(i, i + 10));
    if (slice.startsWith("end_header")) {
      end = Math.min(bytes.length, i + 12);
      break;
    }
  }
  return new TextDecoder("latin1").decode(bytes.subarray(0, end)).toLowerCase();
}

export async function inspectPly(blob: Blob): Promise<PlyCheck> {
  const header = decodeHeader(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  if (!header.includes("ply")) {
    return {
      kind: "unknown",
      header,
      reason: "This file does not look like a PLY (missing ply header).",
    };
  }

  const hasGaussianProperty = GAUSSIAN_PROPERTIES.some((name) => header.includes(name));
  const hasChunkElement = header.includes("element chunk");
  const hasVertex = header.includes("element vertex");

  if (hasGaussianProperty || hasChunkElement) {
    return {
      kind: "gaussian",
      header,
      reason: "Gaussian splat PLY",
    };
  }

  if (hasVertex) {
    return {
      kind: "mesh",
      header,
      reason:
        "This is a mesh or point-cloud PLY, not a 3D Gaussian splat. Export from SuperSplat, INRIA 3DGS, Polycam, or similar.",
    };
  }

  return {
    kind: "unknown",
    header,
    reason: "PLY header did not include Gaussian splat properties (scale_0, rot_0, f_dc_0, opacity).",
  };
}
