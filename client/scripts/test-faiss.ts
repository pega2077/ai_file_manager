import path from 'path';
import fs from 'fs/promises';
import faiss from 'faiss-node';

async function main() {
    // Use faiss-node (CJS) via default import (esModuleInterop)
    const { IndexFlatL2 } = faiss;
    console.log('[FAISS] faiss-node module loaded', faiss);
    // Create a 4-dimensional L2 index and insert a few test vectors
    const dim = 4;
    const index = new IndexFlatL2(dim);

    const vectors: number[][] = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
        [1, 1, 0, 0],
    ];
    const flatVectors = vectors.flat();
    index.add(flatVectors);

    console.log(`[FAISS] Inserted vectors: ${index.ntotal()} (dim=${index.getDimension()})`);

    // Run a simple search before persistence
    const query: number[] = [1, 0.9, 0, 0];
    const k = 3;
    const resBefore = index.search(query, k);
    console.log('[FAISS] Search before save - labels:', resBefore.labels, 'distances:', resBefore.distances);

    // Prepare persistence path: client/database/vectors/test_flatl2_d4.faiss
    const vectorsDir = path.resolve(process.cwd(), 'database', 'vectors');
    await fs.mkdir(vectorsDir, { recursive: true });
    const indexFilePath = path.join(vectorsDir, `test_flatl2_d${dim}.faiss`);

    // Persist index to disk and load back
    index.write(indexFilePath);
    console.log('[FAISS] Index saved to:', indexFilePath);

    const loadedIndex = IndexFlatL2.read(indexFilePath);
    console.log(`[FAISS] Loaded index - ntotal=${loadedIndex.ntotal()} dim=${loadedIndex.getDimension()} trained=${loadedIndex.isTrained()}`);

    const resAfter = loadedIndex.search(query, k);
    console.log('[FAISS] Search after load  - labels:', resAfter.labels, 'distances:', resAfter.distances);

    // Demonstrate restricted-id search
    const allowedIds = new Set<number>([0, 4]);
    const filtered = searchWithinIdsByFilter(loadedIndex, query, k, allowedIds, 5);
    console.log('[FAISS] Filtered (by filter)   - labels:', filtered.labels, 'distances:', filtered.distances);

    const filteredClone = searchWithinIdsByClone(loadedIndex, query, k, allowedIds);
    console.log('[FAISS] Filtered (by clone)    - labels:', filteredClone.labels, 'distances:', filteredClone.distances);
}

main().catch((err) => {
    console.error('Test failed with error:', err);
});

// Restrict search to a set of allowed IDs by oversampling and filtering results in-memory.
function searchWithinIdsByFilter(
    index: { ntotal: () => number; search: (x: number[], k: number) => { labels: number[]; distances: number[] } },
    query: number[],
    k: number,
    allowedIds: Set<number>,
    oversampleFactor = 4
) {
    const ntotal = index.ntotal();
    const kPrime = Math.min(ntotal, Math.max(k, k * oversampleFactor));
    const res = index.search(query, kPrime);
    const labels = res.labels;
    const distances = res.distances;
    const outLabels: number[] = [];
    const outDistances: number[] = [];
    for (let i = 0; i < labels.length && outLabels.length < k; i += 1) {
        const lbl = labels[i];
        if (lbl === -1) continue;
        if (allowedIds.has(lbl)) {
            outLabels.push(lbl);
            outDistances.push(distances[i]);
        }
    }
    return { labels: outLabels, distances: outDistances };
}

// Restrict search by cloning the index and removing all IDs not in the allowed set (exact restriction, heavier operation).
function searchWithinIdsByClone(
    index: { ntotal: () => number; toBuffer: () => Buffer; search: (x: number[], k: number) => { labels: number[]; distances: number[] } },
    query: number[],
    k: number,
    allowedIds: Set<number>
) {
    const { Index } = faiss;
    const clone = Index.fromBuffer(index.toBuffer());
    const ntotal = clone.ntotal();
    // Build list of IDs to remove: complement of allowed within [0, ntotal)
    const toRemove: number[] = [];
    for (let id = 0; id < ntotal; id += 1) {
        if (!allowedIds.has(id)) toRemove.push(id);
    }
    if (toRemove.length > 0) {
        try {
            clone.removeIds(toRemove);
        } catch (e) {
            // If removeIds fails (e.g., not supported for certain index types), fallback to filter method
            return searchWithinIdsByFilter(index, query, k, allowedIds);
        }
    }
    const kk = Math.min(k, allowedIds.size);
    return clone.search(query, kk);
}
