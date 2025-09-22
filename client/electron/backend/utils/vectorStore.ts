import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { logger } from "../../logger";
import { configManager } from "../../configManager";

// Lazy import to avoid crashing if optional dependency not present at build time
let faiss: unknown;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  faiss = require("faiss-node");
} catch (e) {
  faiss = null;
  logger.warn("faiss-node is not installed; vector store operations will be disabled");
}

export function getRagDir(): string {
  // Store alongside sqlite DB by default
  const base = path.dirname(configManager.getDatabaseAbsolutePath());
  const dir = path.join(base, "vectors");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    logger.warn("Failed to ensure RAG vectors directory", e as unknown);
  }
  return dir;
}

export function getGlobalIndexPath(): string {
  return path.join(getRagDir(), `faiss_index.bin`);
}

function toBigInt64Array(ids: number[]): BigInt64Array {
  const arr = new BigInt64Array(ids.length);
  for (let i = 0; i < ids.length; i++) arr[i] = BigInt(ids[i]);
  return arr;
}

export async function updateGlobalFaissIndex(params: {
  addIds: number[];
  vectors: number[][];
  removeIds?: number[];
}): Promise<{ path: string; dim: number; addCount: number; removed?: number }>{
  if (!faiss) throw new Error("faiss-node not available");
  const ffi = faiss as {
    IndexFlatL2: new (d: number) => unknown;
    IndexIDMap: new (base: unknown) => unknown;
    deserializeIndex?: (buf: Buffer) => unknown;
  };

  const { addIds, vectors, removeIds } = params;
  if (!Array.isArray(vectors) || vectors.length === 0) throw new Error("No vectors to add");
  if (addIds.length !== vectors.length) throw new Error("addIds length must match vectors length");

  const dim = vectors[0].length;
  for (const v of vectors) if (v.length !== dim) throw new Error("Inconsistent vector dimensions");

  const flat = new Float32Array(vectors.length * dim);
  let o = 0;
  for (const v of vectors) { for (let i = 0; i < dim; i++) flat[o++] = v[i] as number; }
  const ids64 = toBigInt64Array(addIds);

  const p = getGlobalIndexPath();
  let index: unknown;
  const exists = await fsp.access(p, fs.constants.F_OK).then(() => true).catch(() => false);
  if (exists && ffi.deserializeIndex) {
    const bytes = await fsp.readFile(p);
    index = ffi.deserializeIndex(bytes);
  } else {
    const base = new ffi.IndexFlatL2(dim);
    index = new ffi.IndexIDMap(base);
  }

  const idx = index as { addWithIds?: (v: Float32Array, ids: BigInt64Array) => void; add?: (v: Float32Array) => void; serialize: () => Buffer; removeIds?: (ids: BigInt64Array) => number };
  // Remove ids if supported and requested
  let removed = 0;
  if (removeIds && removeIds.length > 0 && typeof idx.removeIds === "function") {
    try {
      const delIds = toBigInt64Array(removeIds);
      removed = idx.removeIds(delIds) ?? 0;
    } catch (e) {
      logger.warn("FAISS removeIds failed; proceeding without deletion", e as unknown);
    }
  }
  if (typeof idx.addWithIds === "function") {
    idx.addWithIds(flat, ids64);
  } else if (typeof idx.add === "function") {
    // Fallback: if index has no ID map, we cannot honor chunk_id mapping
    throw new Error("FAISS index does not support addWithIds; ID mapping required");
  }

  const out: Buffer = idx.serialize();
  await fsp.writeFile(p, out);
  return { path: p, dim, addCount: vectors.length, removed };
}
