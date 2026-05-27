/**
 * HNSW (Hierarchical Navigable Small World) Vector Index
 *
 * A pure JavaScript implementation of approximate nearest neighbor search.
 * Replaces linear scan cosine similarity with O(log N) search time.
 *
 * Key properties:
 *   - Build: O(N * log N) time, O(N * M) space
 *   - Search: O(log N) average with high recall (>95%)
 *   - M: max connections per node (default 16)
 *   - efConstruction: beam width during build (default 200)
 *   - efSearch: beam width during query (default 50)
 *
 * Reference: Malkov & Yashunin, 2018 — "Efficient and robust approximate nearest neighbor search using HNSW graphs"
 */

export class HNSWIndex {
  constructor(opts = {}) {
    this.M = opts.M || 16;                    // Max connections per layer
    this.Mmax0 = opts.Mmax0 || this.M * 2;   // Max connections at layer 0
    this.efConstruction = opts.efConstruction || 200;
    this.efSearch = opts.efSearch || 50;
    this.mL = 1 / Math.log(this.M);          // Level generation factor

    this.nodes = [];     // [{ id, vector, data }]
    this.graphs = [];    // graphs[level] = Map<nodeIndex, Set<nodeIndex>>
    this.entryPoint = -1;
    this.maxLevel = -1;
  }

  /**
   * Add a vector to the index.
   * @param {string} id - Unique identifier
   * @param {number[]} vector - Embedding vector
   * @param {Object} [data] - Associated metadata
   */
  insert(id, vector, data = {}) {
    const nodeIdx = this.nodes.length;
    this.nodes.push({ id, vector, data });

    // Generate random level for this node
    const level = Math.floor(-Math.log(Math.random()) * this.mL);

    // Ensure graph layers exist
    while (this.graphs.length <= level) {
      this.graphs.push(new Map());
    }

    // Initialize connections for this node at each level
    for (let l = 0; l <= level; l++) {
      this.graphs[l].set(nodeIdx, new Set());
    }

    if (this.entryPoint === -1) {
      this.entryPoint = nodeIdx;
      this.maxLevel = level;
      return;
    }

    let currNode = this.entryPoint;

    // Phase 1: Greedy search from top to node's level + 1
    for (let l = this.maxLevel; l > level; l--) {
      currNode = this._greedyClosest(vector, currNode, l);
    }

    // Phase 2: Insert at each level from node's level down to 0
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const neighbors = this._searchLayer(vector, currNode, this.efConstruction, l);
      const maxConn = l === 0 ? this.Mmax0 : this.M;
      const selected = this._selectNeighbors(vector, neighbors, maxConn);

      // Connect node to selected neighbors
      for (const neighbor of selected) {
        this.graphs[l].get(nodeIdx).add(neighbor);
        this.graphs[l].get(neighbor).add(nodeIdx);

        // Prune neighbor connections if over limit
        const neighborConns = this.graphs[l].get(neighbor);
        if (neighborConns.size > maxConn) {
          const pruned = this._selectNeighbors(
            this.nodes[neighbor].vector,
            [...neighborConns],
            maxConn
          );
          this.graphs[l].set(neighbor, new Set(pruned));
        }
      }

      if (selected.length > 0) {
        currNode = selected[0];
      }
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = nodeIdx;
    }
  }

  /**
   * Search for k nearest neighbors.
   * @param {number[]} query - Query vector
   * @param {number} k - Number of results
   * @returns {Array<{ id: string, score: number, data: Object }>}
   */
  search(query, k = 10) {
    if (this.entryPoint === -1) return [];

    let currNode = this.entryPoint;

    // Traverse from top level to level 1
    for (let l = this.maxLevel; l > 0; l--) {
      currNode = this._greedyClosest(query, currNode, l);
    }

    // Search at layer 0 with efSearch beam width
    const candidates = this._searchLayer(query, currNode, Math.max(this.efSearch, k), 0);

    // Return top-k
    return candidates
      .map(idx => ({
        id: this.nodes[idx].id,
        score: this._similarity(query, this.nodes[idx].vector),
        data: this.nodes[idx].data,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Get index statistics.
   */
  stats() {
    const layerSizes = this.graphs.map(g => g.size);
    const avgConnections = this.graphs.length > 0
      ? this.graphs[0].size > 0
        ? [...this.graphs[0].values()].reduce((s, c) => s + c.size, 0) / this.graphs[0].size
        : 0
      : 0;

    return {
      totalVectors: this.nodes.length,
      layers: this.graphs.length,
      layerSizes,
      avgConnections: Math.round(avgConnections * 10) / 10,
      entryPoint: this.entryPoint,
      M: this.M,
      efSearch: this.efSearch,
      dimensions: this.nodes.length > 0 ? this.nodes[0].vector.length : 0,
    };
  }

  // === Internal methods ===

  _similarity(a, b) {
    // Cosine similarity
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  _greedyClosest(query, startNode, level) {
    let currNode = startNode;
    let currDist = this._similarity(query, this.nodes[currNode].vector);

    let improved = true;
    while (improved) {
      improved = false;
      const neighbors = this.graphs[level]?.get(currNode);
      if (!neighbors) break;

      for (const neighbor of neighbors) {
        const dist = this._similarity(query, this.nodes[neighbor].vector);
        if (dist > currDist) {
          currDist = dist;
          currNode = neighbor;
          improved = true;
        }
      }
    }
    return currNode;
  }

  _searchLayer(query, entryNode, ef, level) {
    const visited = new Set([entryNode]);
    const candidates = [{ idx: entryNode, score: this._similarity(query, this.nodes[entryNode].vector) }];
    const results = [...candidates];

    while (candidates.length > 0) {
      // Get closest unprocessed candidate
      candidates.sort((a, b) => b.score - a.score);
      const current = candidates.shift();

      // Get furthest result
      results.sort((a, b) => b.score - a.score);
      const furthestResult = results[results.length - 1];

      if (current.score < furthestResult.score && results.length >= ef) break;

      const neighbors = this.graphs[level]?.get(current.idx);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);

        const score = this._similarity(query, this.nodes[neighbor].vector);
        results.sort((a, b) => b.score - a.score);
        const furthest = results[results.length - 1];

        if (score > furthest.score || results.length < ef) {
          candidates.push({ idx: neighbor, score });
          results.push({ idx: neighbor, score });

          if (results.length > ef) {
            results.sort((a, b) => b.score - a.score);
            results.pop();
          }
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).map(r => r.idx);
  }

  _selectNeighbors(query, candidates, maxConn) {
    // Simple: keep closest
    return candidates
      .map(idx => ({ idx, score: this._similarity(query, this.nodes[idx].vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxConn)
      .map(r => r.idx);
  }
}

/**
 * Create and populate an HNSW index from existing vector store data.
 * @param {Array<{ id: string, embedding: number[], file?: string, content?: string }>} vectors
 * @param {Object} [opts]
 * @returns {HNSWIndex}
 */
export function buildIndex(vectors, opts = {}) {
  const index = new HNSWIndex(opts);
  for (const v of vectors) {
    if (!v.embedding || v.embedding.length === 0) continue;
    index.insert(v.id || v.file || `chunk-${index.nodes.length}`, v.embedding, {
      file: v.file,
      content: v.content || v.text || '',
      lines: v.lines,
    });
  }
  return index;
}
