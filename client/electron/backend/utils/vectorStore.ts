import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import faiss from "faiss-node";
import { logger } from "../../logger";
import { configManager } from "../../configManager";


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

export function isFaissAvailable(): boolean {
  return !!faiss;
}

export async function globalIndexExists(): Promise<boolean> {
  const p = getGlobalIndexPath();
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function updateGlobalFaissIndex(params: {
  addIds: number[];
  vectors: number[][];
  removeIds?: number[];
}): Promise<{ path: string; dim: number; addCount: number; removed?: number }>{
  const { addIds, vectors } = params;
  const removeIds = Array.isArray(params.removeIds) ? Array.from(new Set(params.removeIds)) : [];

  if (!isFaissAvailable()) {
    throw new Error("FAISS is not available in this runtime");
  }
  if (!Array.isArray(addIds) || !Array.isArray(vectors) || addIds.length !== vectors.length) {
    throw new Error("addIds and vectors must be arrays of equal length");
  }
  if (addIds.length === 0 && removeIds.length === 0) {
    return { path: getGlobalIndexPath(), dim: 0, addCount: 0, removed: 0 };
  }

  // Validate vector dimensions
  const dim = vectors[0]?.length ?? 0;
  if (addIds.length > 0) {
    if (!Number.isInteger(dim) || dim <= 0) throw new Error("Vectors must be non-empty with consistent dimensions");
    for (let i = 0; i < vectors.length; i++) {
      if (!Array.isArray(vectors[i]) || vectors[i].length !== dim) {
        throw new Error(`Vector at index ${i} has invalid dimension`);
      }
    }
  }

  const indexPath = getGlobalIndexPath();
  const metaPath = path.join(getRagDir(), "faiss_index.meta.json");

  // Load or create index
  let index: faiss.Index;
  let meta: { version: number; dim: number; labels: number[] } = { version: 1, dim: dim || 0, labels: [] };
  const indexExists = await globalIndexExists();
  if (indexExists) {
    try {
      index = faiss.Index.read(indexPath);
    } catch (e) {
      logger.error("Failed to read existing FAISS index", e as unknown);
      throw new Error("Failed to read existing FAISS index");
    }
    // Load metadata
    try {
      const raw = await fsp.readFile(metaPath, "utf-8").catch(() => "");
      if (raw) {
        const parsed = JSON.parse(raw) as typeof meta;
        if (Array.isArray(parsed.labels)) meta = parsed;
      }
    } catch (e) {
      logger.warn("Failed to read FAISS meta; will attempt to recover with identity mapping", e as unknown);
    }

    // Validate dimension consistency when adding
    const existDim = index.getDimension();
    if (addIds.length > 0 && existDim !== dim) {
      throw new Error(`Vector dimension mismatch: existing=${existDim}, incoming=${dim}`);
    }

    // Ensure meta aligns with index
    const ntotal = index.ntotal();
    if (!Array.isArray(meta.labels) || meta.labels.length !== ntotal) {
      logger.warn("FAISS meta labels length mismatch; rebuilding identity mapping", { metaLen: meta.labels?.length, ntotal });
      meta = { version: 1, dim: existDim, labels: Array.from({ length: ntotal }, (_, i) => i) };
    }
  } else {
    // Create new IndexFlatL2
    if (dim <= 0) throw new Error("Cannot create index: missing vector dimension");
    try {
      // Use L2 flat index by default
      const { IndexFlatL2 } = faiss as unknown as { IndexFlatL2: new (d: number) => faiss.Index };
      index = new IndexFlatL2(dim);
      meta = { version: 1, dim, labels: [] };
    } catch (e) {
      logger.error("Failed to create FAISS IndexFlatL2", e as unknown);
      throw new Error("Failed to create FAISS IndexFlatL2");
    }
  }

  // Apply removals first
  let removedCount = 0;
  if (removeIds.length > 0 && index.ntotal() > 0) {
    const removeSet = new Set(removeIds);
    // Identify label positions to remove based on mapping
    const labelsToRemove: number[] = [];
    for (let lbl = 0; lbl < meta.labels.length; lbl++) {
      const chunkId = meta.labels[lbl];
      if (removeSet.has(chunkId)) labelsToRemove.push(lbl);
    }
    if (labelsToRemove.length > 0) {
      // Remove from index; faiss compacts labels, preserving order of remaining vectors
      try {
        removedCount = index.removeIds(labelsToRemove);
        // Update mapping by removing those label slots (descending to keep indices stable)
        labelsToRemove.sort((a, b) => b - a).forEach((lbl) => {
          meta.labels.splice(lbl, 1);
        });
      } catch (e) {
        logger.error("Failed to remove IDs from FAISS index", { count: labelsToRemove.length, err: e as unknown });
        throw new Error("Failed to remove IDs from FAISS index");
      }
    }
  }

  // Add new vectors
  if (addIds.length > 0) {
    // Flatten vectors row-major
    const flat: number[] = new Array(addIds.length * dim);
    for (let i = 0; i < addIds.length; i++) {
      const row = vectors[i]!;
      for (let d = 0; d < dim; d++) flat[i * dim + d] = row[d]!;
    }
    try {
      index.add(flat);
      // Append external chunk IDs in the same order; labels are assigned sequentially
      for (let i = 0; i < addIds.length; i++) meta.labels.push(addIds[i]!);
    } catch (e) {
      logger.error("Failed to add vectors to FAISS index", e as unknown);
      throw new Error("Failed to add vectors to FAISS index");
    }
  }

  // Persist index and metadata
  try {
    index.write(indexPath);
  } catch (e) {
    logger.error("Failed to write FAISS index to disk", { path: indexPath, err: e as unknown });
    throw new Error("Failed to persist FAISS index");
  }

  try {
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch (e) {
    logger.error("Failed to write FAISS meta to disk", { path: metaPath, err: e as unknown });
    throw new Error("Failed to persist FAISS metadata");
  }

  logger.info("Updated global FAISS index", { path: indexPath, dim: meta.dim, addCount: addIds.length, removed: removedCount, total: meta.labels.length });
  return { path: indexPath, dim: meta.dim, addCount: addIds.length, removed: removedCount };
}

/**
 * Search the global FAISS index for nearest neighbors of a single query vector.
 * Returns arrays of ids (chunk row ids) and distances (L2 or metric-specific).
 */
export async function searchGlobalFaissIndex(params: {
  query: number[];
  k: number;
  oversample?: number; // fetch more then filter client-side if needed
}): Promise<{ ids: number[]; distances: number[]; dim: number }>{
  const { query, k } = params;
  const oversample = typeof params.oversample === "number" && params.oversample > 1 ? Math.floor(params.oversample) : 4;

  const indexPath = getGlobalIndexPath();
  const metaPath = path.join(getRagDir(), "faiss_index.meta.json");

  // If index missing, return empty
  if (!(await globalIndexExists())) {
    logger.warn("FAISS index not found when searching", { indexPath });
    return { ids: [], distances: [], dim: 0 };
  }

  // Read index
  let index: faiss.Index;
  try {
    index = faiss.Index.read(indexPath);
  } catch (e) {
    logger.error("Failed to read FAISS index for search", e as unknown);
    return { ids: [], distances: [], dim: 0 };
  }

  const dim = index.getDimension();
  if (!Array.isArray(query) || query.length !== dim) {
    logger.warn("Query vector dimension mismatch", { expected: dim, got: query?.length ?? 0 });
    return { ids: [], distances: [], dim };
  }

  // Load meta mapping
  let labelsMap: number[] = [];
  try {
    const raw = await fsp.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw) as { labels: number[] };
    if (Array.isArray(meta.labels)) labelsMap = meta.labels;
  } catch (e) {
    logger.warn("Failed to read FAISS metadata; falling back to identity labels", e as unknown);
  }
  if (labelsMap.length !== index.ntotal()) {
    // Identity fallback
    labelsMap = Array.from({ length: index.ntotal() }, (_, i) => i);
  }

  const ntotal = index.ntotal();
  const kPrime = Math.min(ntotal, Math.max(k, k * oversample));
  const res = index.search(query, kPrime);

  const outIds: number[] = [];
  const outDistances: number[] = [];
  for (let i = 0; i < res.labels.length && outIds.length < k; i++) {
    const lbl = res.labels[i];
    if (lbl === -1) continue;
    const extId = labelsMap[lbl];
    if (extId === undefined) continue;
    outIds.push(extId);
    outDistances.push(res.distances[i]);
  }

  return { ids: outIds, distances: outDistances, dim };
}
