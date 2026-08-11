import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { ConfigManager } from './config';
import { initDb } from '../db/schema';
import { syncMemoryToDb, deleteMemoryFromDb } from '../db/sync';
import { parseMemory, serializeMemory, createMemoryMetadata } from './memory';
import { GitManager } from './git';
import { Memory, MemoryRelation, MemoryType, MultiHopMemoryResult, MultiHopRecallResponse, RelationType } from '../types';
import { getContextDbPath, getContextMemoriesPath, ensureDirectories } from '../utils/paths';
import { generateWorkspaceFileVertices, makeFileVertexId, ScanOptions } from '../utils/fileGraphScanner';

export class ContextManager {
  public readonly name: string;
  private db: Database.Database;
  private git: GitManager;
  private memoriesPath: string;

  constructor(name: string) {
    this.name = name;
    ensureDirectories(name);
    
    this.memoriesPath = getContextMemoriesPath(name);
    const dbPath = getContextDbPath(name);
    
    this.db = initDb(dbPath);
    this.git = new GitManager(name);
  }

  public getDb(): Database.Database {
    return this.db;
  }

  private getSafeMemPath(id: string): string {
    const safeId = path.basename(id, '.md');
    return path.join(this.memoriesPath, `${safeId}.md`);
  }

  public resolveTargetId(target: string): string {
    const trimmed = target.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('mem_') || trimmed.startsWith('file_')) {
      return trimmed;
    }
    // Check if target exists as a memory in DB
    try {
      const exists = this.db.prepare('SELECT id FROM memories WHERE id = ?').get(trimmed);
      if (exists) {
        return trimmed;
      }
    } catch {}
    // Otherwise treat as a file path
    return makeFileVertexId(trimmed);
  }

  public addMemory(
    type: MemoryType,
    title: string,
    content: string,
    tags: string[] = [],
    source: Memory['metadata']['source'] = 'manual',
    customId?: string,
    targetOrTargets?: string | string[],
    relationType: string = 'affects',
    explicitRelations?: MemoryRelation[]
  ): string {
    const id = customId || `mem_${crypto.randomBytes(6).toString('hex')}`;
    const relations: MemoryRelation[] = [];
    const relationKeys = new Set<string>();

    const addRel = (target: string, relType: string) => {
      const resolvedTarget = this.resolveTargetId(target);
      if (!resolvedTarget) return;
      const key = `${resolvedTarget}:${relType}`;
      if (!relationKeys.has(key)) {
        relationKeys.add(key);
        relations.push({ target: resolvedTarget, type: relType as any });
      }
    };

    if (explicitRelations && Array.isArray(explicitRelations)) {
      for (const rel of explicitRelations) {
        if (rel && rel.target) {
          addRel(rel.target, rel.type || 'related_to');
        }
      }
    }

    if (targetOrTargets) {
      const targetList = Array.isArray(targetOrTargets) 
        ? targetOrTargets 
        : targetOrTargets.split(',').map(s => s.trim()).filter(Boolean);

      for (const t of targetList) {
        const resolved = this.resolveTargetId(t);
        let effectiveType = relationType;
        if (resolved.startsWith('mem_') && relationType === 'affects') {
          effectiveType = 'related_to';
        }
        addRel(t, effectiveType);
      }
    }

    const memory: Memory = {
      metadata: createMemoryMetadata(id, type, title, this.name, tags, relations, source),
      content
    };

    this.saveMemory(memory, `[stormdrain] add: ${type} "${title}"`);
    return id;
  }

  public updateMemory(
    id: string,
    content?: string,
    title?: string,
    tags?: string[],
    type?: MemoryType,
    options?: {
      relations?: MemoryRelation[];
      addRelations?: MemoryRelation[];
      removeRelations?: Array<{ target: string; type?: string }>;
      addTargets?: string | string[];
      removeTargets?: string | string[];
    }
  ) {
    const memory = this.getMemory(id);
    if (!memory) throw new Error(`Memory ${id} not found.`);

    if (content !== undefined) memory.content = content;
    if (title !== undefined) memory.metadata.title = title;
    if (tags !== undefined) memory.metadata.tags = tags;
    if (type !== undefined) memory.metadata.type = type;

    if (options) {
      if (options.relations) {
        memory.metadata.relations = options.relations.map(r => ({
          target: this.resolveTargetId(r.target),
          type: r.type || 'related_to'
        }));
      }

      if (options.addRelations) {
        const existingKeys = new Set(memory.metadata.relations.map(r => `${r.target}:${r.type}`));
        for (const rel of options.addRelations) {
          const resolved = this.resolveTargetId(rel.target);
          const relType = rel.type || 'related_to';
          const key = `${resolved}:${relType}`;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            memory.metadata.relations.push({ target: resolved, type: relType });
          }
        }
      }

      if (options.addTargets) {
        const targets = Array.isArray(options.addTargets) ? options.addTargets : [options.addTargets];
        const existingKeys = new Set(memory.metadata.relations.map(r => `${r.target}:${r.type}`));
        for (const t of targets) {
          const resolved = this.resolveTargetId(t);
          const relType = resolved.startsWith('mem_') ? 'related_to' : 'affects';
          const key = `${resolved}:${relType}`;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            memory.metadata.relations.push({ target: resolved, type: relType });
          }
        }
      }

      if (options.removeRelations) {
        memory.metadata.relations = memory.metadata.relations.filter(r => {
          return !options.removeRelations!.some(rem => {
            const remTarget = this.resolveTargetId(rem.target);
            return r.target === remTarget && (!rem.type || r.type === rem.type);
          });
        });
      }

      if (options.removeTargets) {
        const targets = (Array.isArray(options.removeTargets) ? options.removeTargets : [options.removeTargets])
          .map(t => this.resolveTargetId(t));
        memory.metadata.relations = memory.metadata.relations.filter(r => !targets.includes(r.target));
      }
    }
    
    memory.metadata.updated = new Date().toISOString();
    this.saveMemory(memory, `[stormdrain] update: ${memory.metadata.type} "${memory.metadata.title}"`);
  }

  public addRelation(sourceId: string, target: string, type: string = 'related_to'): boolean {
    const memory = this.getMemory(sourceId);
    if (!memory) throw new Error(`Source memory "${sourceId}" not found.`);

    const resolvedTarget = this.resolveTargetId(target);
    if (!resolvedTarget) throw new Error(`Invalid target "${target}".`);

    const exists = memory.metadata.relations.some(r => r.target === resolvedTarget && r.type === type);
    if (exists) return false;

    memory.metadata.relations.push({ target: resolvedTarget, type });
    memory.metadata.updated = new Date().toISOString();
    this.saveMemory(memory, `[stormdrain] relate: ${sourceId} -> ${resolvedTarget} (${type})`);
    return true;
  }

  public removeRelation(sourceId: string, target: string, type?: string): boolean {
    const memory = this.getMemory(sourceId);
    if (!memory) throw new Error(`Source memory "${sourceId}" not found.`);

    const resolvedTarget = this.resolveTargetId(target);
    const initialLen = memory.metadata.relations.length;

    memory.metadata.relations = memory.metadata.relations.filter(r => {
      if (r.target !== resolvedTarget) return true;
      if (type && r.type !== type) return true;
      return false;
    });

    if (memory.metadata.relations.length === initialLen) {
      return false;
    }

    memory.metadata.updated = new Date().toISOString();
    this.saveMemory(memory, `[stormdrain] unrelate: ${sourceId} -x- ${resolvedTarget}`);
    return true;
  }

  public getRelations(memoryId: string): {
    outgoing: MemoryRelation[];
    incoming: Array<{ source: string; type: string }>;
  } {
    const mem = this.getMemory(memoryId);
    const outgoing = mem ? mem.metadata.relations : [];

    const resolvedId = this.resolveTargetId(memoryId);
    const incomingRows = this.db.prepare(`
      SELECT source_id as source, type FROM relations WHERE target_id = ?
    `).all(resolvedId) as Array<{ source: string; type: string }>;

    return {
      outgoing,
      incoming: incomingRows
    };
  }


  public getMemory(id: string): Memory | null {
    const memPath = this.getSafeMemPath(id);
    if (!fs.existsSync(memPath)) return null;

    const content = fs.readFileSync(memPath, 'utf8');
    return parseMemory(content);
  }

  public deleteMemory(id: string) {
    const memPath = this.getSafeMemPath(id);
    if (fs.existsSync(memPath)) {
      const memory = this.getMemory(id);
      fs.unlinkSync(memPath);
      deleteMemoryFromDb(this.db, id);
      this.git.scheduleCommit(`[stormdrain] delete: memory ${id} "${memory?.metadata.title || ''}"`);
    }
  }

  private saveMemory(memory: Memory, commitMsg: string) {
    const memPath = this.getSafeMemPath(memory.metadata.id);
    fs.writeFileSync(memPath, serializeMemory(memory));
    syncMemoryToDb(this.db, memory);
    this.git.scheduleCommit(commitMsg);
  }

  public syncFileGraph(workspaceDir: string, scanOptions?: ScanOptions): { createdCount: number; decayedCount: number } {
    const vertices = generateWorkspaceFileVertices(workspaceDir, scanOptions);
    let createdCount = 0;
    let decayedCount = 0;

    for (const v of vertices) {
      const existing = this.getMemory(v.id);
      if (existing) {
        const hashMatch = existing.content.match(/Hash: `([^`]+)`/);
        const oldHash = hashMatch ? hashMatch[1] : '';
        if (oldHash && oldHash !== v.hash) {
          // File content changed! Find all memories attached to this file vertex
          const attachedRelations = this.db.prepare(`
            SELECT source_id FROM relations WHERE target_id = ? AND type IN ('affects', 'applies_to')
          `).all(v.id) as Array<{ source_id: string }>;

          for (const rel of attachedRelations) {
            const attachedMem = this.getMemory(rel.source_id);
            if (attachedMem && attachedMem.metadata.type !== 'codemap') {
              const oldConf = attachedMem.metadata.confidence;
              attachedMem.metadata.confidence = Math.max(0.3, Math.round(oldConf * 0.75 * 100) / 100);
              attachedMem.metadata.updated = new Date().toISOString();
              if (!attachedMem.metadata.tags.includes('stale')) {
                attachedMem.metadata.tags.push('stale');
              }
              this.saveMemory(attachedMem, `[stormdrain] decay: memory ${attachedMem.metadata.id} due to ${v.relativePath} hash change`);
              decayedCount++;
            }
          }
        }
      }

      const relations = v.imports.map(impPath => ({
        target: makeFileVertexId(impPath),
        type: 'imports'
      }));

      const memory: Memory = {
        metadata: createMemoryMetadata(v.id, 'codemap', v.title, this.name, v.tags, relations, 'auto-scan'),
        content: v.content
      };

      this.saveMemory(memory, `[stormdrain] sync: file vertex "${v.relativePath}"`);
      createdCount++;
    }

    return { createdCount, decayedCount };
  }

  public pruneOrphanCodemaps(validWorkspaceRoots: string[]): { prunedCount: number } {
    const normRoots = validWorkspaceRoots.map(r => path.resolve(r));
    const allCodemaps = this.db.prepare(`
      SELECT id, title FROM memories WHERE type = 'codemap'
    `).all() as Array<{ id: string; title: string }>;

    let prunedCount = 0;
    for (const cm of allCodemaps) {
      const relPathMatch = cm.title.match(/^\[File\]\s*(.+)$/);
      const relPath = relPathMatch ? relPathMatch[1].trim() : '';

      let existsInRoots = false;
      if (relPath) {
        for (const root of normRoots) {
          const fullPath = path.resolve(root, relPath);
          if (fs.existsSync(fullPath)) {
            existsInRoots = true;
            break;
          }
        }
      }

      if (!existsInRoots) {
        this.deleteMemory(cm.id);
        prunedCount++;
      }
    }

    return { prunedCount };
  }

  public removeVerticesByPattern(
    pattern: string,
    options?: { dryRun?: boolean }
  ): { matchedCount: number; removedCount: number; matchedFiles: string[] } {
    const dryRun = options?.dryRun ?? false;

    // Get all codemap memories
    const allCodemaps = this.db.prepare(`
      SELECT id, title FROM memories WHERE type = 'codemap'
    `).all() as Array<{ id: string; title: string }>;

    // Build glob matcher from pattern
    const matcher = buildPatternMatcher(pattern);

    const matchedFiles: string[] = [];
    const matchedIds: string[] = [];

    for (const cm of allCodemaps) {
      // Extract relative path from title: "[File] src/foo.ts" or "[Submodule] lib/bar"
      const relPathMatch = cm.title.match(/^\[(File|Submodule|Codemap)\]\s*(.+)$/);
      const relPath = relPathMatch ? relPathMatch[2].trim() : '';

      if (relPath && matcher(relPath)) {
        matchedFiles.push(relPath);
        matchedIds.push(cm.id);
      }
    }

    let removedCount = 0;
    if (!dryRun) {
      for (const id of matchedIds) {
        this.deleteMemory(id);
        removedCount++;
      }
    }

    return {
      matchedCount: matchedFiles.length,
      removedCount,
      matchedFiles
    };
  }

  public consolidateNeighborhood(targetFileOrId: string): { consolidatedId: string; mergedCount: number } {

    const targetId = targetFileOrId.startsWith('file_') ? targetFileOrId : makeFileVertexId(targetFileOrId);

    // Find non-codemap memories attached to this target vertex
    const relations = this.db.prepare(`
      SELECT source_id FROM relations WHERE target_id = ? AND type IN ('affects', 'applies_to')
    `).all(targetId) as Array<{ source_id: string }>;

    const memories: Memory[] = [];
    for (const rel of relations) {
      const mem = this.getMemory(rel.source_id);
      if (mem && mem.metadata.type !== 'codemap' && !mem.metadata.tags.includes('consolidated')) {
        memories.push(mem);
      }
    }

    if (memories.length < 2) {
      return { consolidatedId: '', mergedCount: 0 };
    }

    const title = `Consolidated Knowledge Guide: ${targetFileOrId}`;
    const allTags = new Set<string>(['consolidated-guide', 'super-memory']);
    
    let combinedContent = `# Consolidated Guide for ${targetFileOrId}\n\n`;
    combinedContent += `This super-memory consolidates ${memories.length} domain micro-memories attached to \`${targetFileOrId}\`.\n\n---\n\n`;

    for (const mem of memories) {
      mem.metadata.tags.forEach(t => allTags.add(t));
      combinedContent += `### [${mem.metadata.type.toUpperCase()}] ${mem.metadata.title} (ID: ${mem.metadata.id})\n`;
      combinedContent += `${mem.content}\n\n`;
      combinedContent += `*Tags: ${mem.metadata.tags.join(', ')}*\n\n---\n\n`;

      // Mark source memory as consolidated
      mem.metadata.tags.push('consolidated');
      mem.metadata.confidence = Math.max(0.4, Math.round(mem.metadata.confidence * 0.7 * 100) / 100);
      this.saveMemory(mem, `[stormdrain] consolidate: marked ${mem.metadata.id} as consolidated`);
    }

    const consolidatedId = this.addMemory(
      'guide',
      title,
      combinedContent,
      Array.from(allTags),
      'consolidator',
      undefined,
      targetFileOrId
    );

    return { consolidatedId, mergedCount: memories.length };
  }

  public recallMultiHop(
    fileOrMemoryId: string,
    options: {
      maxDepth?: number;
      cumulativeThreshold?: number;
      maxResults?: number;
      epsilon?: number;
      alpha?: number;
      includeCodemaps?: boolean;
    } = {}
  ): MultiHopRecallResponse {
    let startNodeId = fileOrMemoryId;
    let isDirectMemoryQuery = false;
    if (fileOrMemoryId.startsWith('mem_')) {
      isDirectMemoryQuery = true;
      const rel = this.db.prepare(`
        SELECT target_id FROM relations WHERE source_id = ? AND type IN ('affects', 'applies_to')
      `).get(fileOrMemoryId) as { target_id: string } | undefined;
      if (rel && rel.target_id.startsWith('file_')) {
        startNodeId = rel.target_id;
      }
    } else if (fileOrMemoryId.includes('/') || fileOrMemoryId.includes('.')) {
      startNodeId = makeFileVertexId(fileOrMemoryId);
    } else {
      try {
        const memExists = this.db.prepare('SELECT id FROM memories WHERE id = ?').get(fileOrMemoryId);
        if (memExists) {
          isDirectMemoryQuery = true;
        }
      } catch {}
    }

    const maxDepth = options.maxDepth ?? 3;
    const cumulativeThreshold = options.cumulativeThreshold ?? 0.85;
    const maxResults = options.maxResults ?? 12;
    const epsilon = options.epsilon ?? 0.0001;
    const alpha = options.alpha ?? 0.20;
    const includeCodemaps = options.includeCodemaps ?? false;

    try {
      // 1. Fetch file vertices and relation edges from DB
      const allRelations = this.db.prepare(`
        SELECT source_id, target_id, type FROM relations
      `).all() as Array<{ source_id: string; target_id: string; type: string }>;

      // Build adjacency list for file nodes
      const outNeighbors = new Map<string, Array<{ target: string; weight: number; direction: 'imports' | 'imported_by' }>>();
      const inWeights = new Map<string, number>();

      const addEdge = (from: string, to: string, weight: number, direction: 'imports' | 'imported_by') => {
        if (!outNeighbors.has(from)) outNeighbors.set(from, []);
        outNeighbors.get(from)!.push({ target: to, weight, direction });
        inWeights.set(to, (inWeights.get(to) || 0) + weight);
      };

      for (const r of allRelations) {
        if (r.type === 'imports') {
          // r.source_id imports r.target_id (forward dependency)
          addEdge(r.source_id, r.target_id, 0.80, 'imports');
          // reverse: r.target_id is imported_by r.source_id (backward consumer)
          addEdge(r.target_id, r.source_id, 0.25, 'imported_by');
        }
      }

      // Compute total weighted capacity W_total(u) = sum(out_weights) + sum(in_weights)
      const getTotalCapacity = (u: string): number => {
        const outList = outNeighbors.get(u) || [];
        const outSum = outList.reduce((acc, e) => acc + e.weight, 0);
        const inSum = inWeights.get(u) || 0;
        return Math.max(0.1, outSum + inSum);
      };

      // 2. Asymmetric Localized ACL Push
      const p = new Map<string, number>();
      const r = new Map<string, number>();
      r.set(startNodeId, 1.0);

      const queue: string[] = [startNodeId];
      const inQueue = new Set<string>([startNodeId]);

      let iterations = 0;
      const maxIterations = 500;

      while (queue.length > 0 && iterations < maxIterations) {
        iterations++;
        const u = queue.shift()!;
        inQueue.delete(u);

        const r_u = r.get(u) || 0;
        const w_total = getTotalCapacity(u);

        if (r_u / w_total < epsilon) {
          continue;
        }

        // Push: local retention (1 - alpha)
        const p_u = p.get(u) || 0;
        p.set(u, p_u + (1 - alpha) * r_u);
        r.set(u, 0);

        const outMass = alpha * r_u;
        const neighbors = outNeighbors.get(u) || [];
        const sumOutWeights = neighbors.reduce((acc, e) => acc + e.weight, 0);

        if (sumOutWeights > 0) {
          for (const edge of neighbors) {
            const frac = edge.weight / sumOutWeights;
            const deltaR = outMass * frac;
            const nextR = (r.get(edge.target) || 0) + deltaR;
            r.set(edge.target, nextR);

            const nextCap = getTotalCapacity(edge.target);
            if (nextR / nextCap >= epsilon && !inQueue.has(edge.target)) {
              queue.push(edge.target);
              inQueue.add(edge.target);
            }
          }
        } else {
          // Sink node: retain mass locally to strictly conserve mass
          p.set(u, (p.get(u) || 0) + outMass);
        }
      }

      // Add remaining residual to p for total conservation
      for (const [node, remR] of r.entries()) {
        if (remR > 0) {
          p.set(node, (p.get(node) || 0) + remR);
        }
      }

      // 3. Normalize PageRank Vector
      let totalP = 0;
      for (const val of p.values()) totalP += val;
      if (totalP <= 0) totalP = 1.0;

      const pNorm = new Map<string, number>();
      for (const [node, val] of p.entries()) {
        pNorm.set(node, val / totalP);
      }

      // 4. Shortest-Path BFS for Direction and Hop Layers
      const dist = new Map<string, number>();
      const nodeDirection = new Map<string, 'direct' | 'upstream_caller' | 'downstream_dependency'>();
      dist.set(startNodeId, 0);
      nodeDirection.set(startNodeId, 'direct');

      const bfsQueue = [startNodeId];
      while (bfsQueue.length > 0) {
        const curr = bfsQueue.shift()!;
        const currDist = dist.get(curr)!;
        if (currDist >= maxDepth) continue;

        const nbs = outNeighbors.get(curr) || [];
        for (const nb of nbs) {
          if (!dist.has(nb.target)) {
            dist.set(nb.target, currDist + 1);
            if (currDist === 0) {
              nodeDirection.set(
                nb.target,
                nb.direction === 'imported_by' ? 'upstream_caller' : 'downstream_dependency'
              );
            } else {
              nodeDirection.set(nb.target, nodeDirection.get(curr) || 'downstream_dependency');
            }
            bfsQueue.push(nb.target);
          }
        }
      }

      // 5. Cumulative Mass Truncation
      const sortedNodes = Array.from(pNorm.entries())
        .filter(([node]) => dist.has(node))
        .sort((a, b) => b[1] - a[1]);

      let cumMass = 0;
      const activeFrontier = new Set<string>();
      for (const [node, normVal] of sortedNodes) {
        activeFrontier.add(node);
        cumMass += normVal;
        if (cumMass >= cumulativeThreshold || activeFrontier.size >= maxResults) {
          break;
        }
      }
      activeFrontier.add(startNodeId);

      // Compute LayerMass for each hop
      const layerMass = new Map<number, number>();
      for (const node of activeFrontier) {
        const h = dist.get(node) ?? 0;
        layerMass.set(h, (layerMass.get(h) || 0) + (pNorm.get(node) || 0));
      }

      // 6. Fact Scoring with Consolidation Shield
      const typeWeights: Record<string, number> = {
        guide: 1.25,
        concept: 1.20,
        warning: 1.15,
        pattern: 1.0,
        lesson: 1.0,
        fact: 0.9,
        sequence: 0.85,
        codemap: 0.1,
      };

      const finalMemories: MultiHopMemoryResult[] = [];

      for (const fileVertexId of activeFrontier) {
        const h = dist.get(fileVertexId) ?? 0;
        const dir = nodeDirection.get(fileVertexId) || 'downstream_dependency';
        const nodeMass = pNorm.get(fileVertexId) || 0;
        const lMass = Math.max(0.001, layerMass.get(h) || 1.0);
        const psi = nodeMass / lMass;

        // If includeCodemaps is true, also add the file vertex itself if present
        if (includeCodemaps) {
          const vertexMem = this.db.prepare(`
            SELECT m.*, fts.content as content_snippet,
              (SELECT GROUP_CONCAT(tag) FROM tags WHERE memory_id = m.id) as tags_str
            FROM memories m
            LEFT JOIN memories_fts fts ON fts.id = m.id
            WHERE m.id = ?
          `).get(fileVertexId) as any;

          if (vertexMem) {
            const tags = (vertexMem.tags_str || '').split(',').filter(Boolean);
            finalMemories.push({
              id: vertexMem.id,
              type: vertexMem.type as MemoryType,
              title: vertexMem.title,
              confidence: vertexMem.confidence,
              depth: h,
              direction: dir,
              relevanceScore: Math.round((vertexMem.confidence * psi * Math.pow(0.75, h) * 0.5) * 1000) / 1000,
              targetFile: fileVertexId,
              tags,
              content_snippet: vertexMem.content_snippet
            });
          }
        }

        // Fetch attached memories
        const attachedRows = this.db.prepare(`
          SELECT m.*, fts.content as content_snippet,
            (SELECT GROUP_CONCAT(tag) FROM tags WHERE memory_id = m.id) as tags_str
          FROM relations r
          JOIN memories m ON m.id = r.source_id
          LEFT JOIN memories_fts fts ON fts.id = m.id
          WHERE r.target_id = ? AND r.type IN ('affects', 'applies_to')
        `).all(fileVertexId) as Array<any>;

        const hasConsolidatedGuide = attachedRows.some(row => {
          const tags = (row.tags_str || '').split(',');
          return row.type === 'guide' && (tags.includes('consolidated-guide') || tags.includes('super-memory'));
        });

        for (const row of attachedRows) {
          if (row.type === 'codemap' && !includeCodemaps) continue; // Exclude raw codemaps unless requested

          const tags = (row.tags_str || '').split(',').filter(Boolean);

          // Consolidation Shield: suppress individual micro-memories if super-memory is active
          if (hasConsolidatedGuide && tags.includes('consolidated')) {
            continue;
          }

          const typeWeight = typeWeights[row.type] || 1.0;
          const hopDecay = Math.pow(0.75, h);
          const score = row.confidence * psi * hopDecay * typeWeight;

          finalMemories.push({
            id: row.id,
            type: row.type as MemoryType,
            title: row.title,
            confidence: row.confidence,
            depth: h,
            direction: dir,
            relevanceScore: Math.round(score * 1000) / 1000,
            targetFile: fileVertexId,
            tags,
            content_snippet: row.content_snippet
          });

          // Also pull in connected memory-to-memory conceptual links (supports, related_to, depends_on, references, part_of)
          const connectedMems = this.db.prepare(`
            SELECT m.*, fts.content as content_snippet,
              (SELECT GROUP_CONCAT(tag) FROM tags WHERE memory_id = m.id) as tags_str,
              r.type as rel_type
            FROM relations r
            JOIN memories m ON (m.id = r.target_id AND r.source_id = ?) OR (m.id = r.source_id AND r.target_id = ?)
            LEFT JOIN memories_fts fts ON fts.id = m.id
            WHERE m.type != 'codemap' AND m.id != ?
          `).all(row.id, row.id, row.id) as Array<any>;

          for (const conn of connectedMems) {
            if (finalMemories.some(fm => fm.id === conn.id)) continue;
            const connTags = (conn.tags_str || '').split(',').filter(Boolean);
            const connTypeWeight = typeWeights[conn.type] || 1.0;
            const connHopDecay = Math.pow(0.75, h + 1);
            const connScore = conn.confidence * psi * connHopDecay * connTypeWeight * 0.85;

            finalMemories.push({
              id: conn.id,
              type: conn.type as MemoryType,
              title: conn.title,
              confidence: conn.confidence,
              depth: h + 1,
              direction: dir,
              relevanceScore: Math.round(connScore * 1000) / 1000,
              targetFile: `via ${row.title} (${conn.rel_type})`,
              tags: connTags,
              content_snippet: conn.content_snippet
            });
          }
        }
      }

      // If direct memory query, ensure target memory and its direct relations are present
      if (isDirectMemoryQuery) {
        const directMem = this.db.prepare(`
          SELECT m.*, fts.content as content_snippet,
            (SELECT GROUP_CONCAT(tag) FROM tags WHERE memory_id = m.id) as tags_str
          FROM memories m
          LEFT JOIN memories_fts fts ON fts.id = m.id
          WHERE m.id = ?
        `).get(fileOrMemoryId) as any;

        if (directMem && !finalMemories.some(fm => fm.id === directMem.id)) {
          finalMemories.unshift({
            id: directMem.id,
            type: directMem.type as MemoryType,
            title: directMem.title,
            confidence: directMem.confidence,
            depth: 0,
            direction: 'direct',
            relevanceScore: 1.0,
            tags: (directMem.tags_str || '').split(',').filter(Boolean),
            content_snippet: directMem.content_snippet
          });
        }

        const relatedToQuery = this.db.prepare(`
          SELECT m.*, fts.content as content_snippet,
            (SELECT GROUP_CONCAT(tag) FROM tags WHERE memory_id = m.id) as tags_str,
            r.type as rel_type
          FROM relations r
          JOIN memories m ON (m.id = r.target_id AND r.source_id = ?) OR (m.id = r.source_id AND r.target_id = ?)
          LEFT JOIN memories_fts fts ON fts.id = m.id
          WHERE m.type != 'codemap' AND m.id != ?
        `).all(fileOrMemoryId, fileOrMemoryId, fileOrMemoryId) as Array<any>;

        for (const conn of relatedToQuery) {
          if (finalMemories.some(fm => fm.id === conn.id)) continue;
          finalMemories.push({
            id: conn.id,
            type: conn.type as MemoryType,
            title: conn.title,
            confidence: conn.confidence,
            depth: 1,
            direction: 'direct',
            relevanceScore: 0.9,
            targetFile: `via ${fileOrMemoryId} (${conn.rel_type})`,
            tags: (conn.tags_str || '').split(',').filter(Boolean),
            content_snippet: conn.content_snippet
          });
        }
      }


      // Sort by relevance score descending
      finalMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);

      const direct = finalMemories.filter(m => m.direction === 'direct');
      const upstream = finalMemories.filter(m => m.direction === 'upstream_caller');
      const downstream = finalMemories.filter(m => m.direction === 'downstream_dependency');

      return {
        direct,
        upstream,
        downstream,
        all: finalMemories
      };
    } catch {
      return { direct: [], upstream: [], downstream: [], all: [] };
    }
  }

  public recallGraph(fileOrMemoryId: string, maxDepth = 2) {
    const res = this.recallMultiHop(fileOrMemoryId, { maxDepth, includeCodemaps: true, cumulativeThreshold: 1.0 });
    return res.all;
  }

  public searchMemories(query: string) {
    const stmt = this.db.prepare(`
      SELECT m.*, fts.content as content_snippet
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.id
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `);
    
    const safeQuery = query
      .split(/\s+/)
      .map(term => term.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F]/g, ''))
      .filter(Boolean)
      .map(term => `"${term}"`)
      .join(' AND ');

    if (!safeQuery) return [];
    
    try {
      return stmt.all(safeQuery);
    } catch {
      return [];
    }
  }

  public recallTopMemories(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      WHERE expires IS NULL OR expires > datetime('now')
      ORDER BY confidence DESC, accessed DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  public markAccessed(id: string) {
    const memory = this.getMemory(id);
    if (memory) {
      memory.metadata.accessed = new Date().toISOString();
      memory.metadata.access_count += 1;
      
      if (memory.metadata.confidence < 1.0) {
        memory.metadata.confidence = Math.min(1.0, memory.metadata.confidence + 0.05);
      }

      this.saveMemory(memory, `[stormdrain] internal: access memory ${id}`);
    }
  }

  public async close() {
    this.db.close();
    await this.git.commit();
  }
}

/**
 * Convert a glob-like pattern to a matcher function.
 * Supports: * (any chars except /), ** (any chars including /), ? (single char),
 * exact paths, and directory prefixes (trailing / or no extension).
 */
function buildPatternMatcher(pattern: string): (filePath: string) => boolean {
  const trimmed = pattern.trim();

  // Exact match shortcut
  if (!trimmed.includes('*') && !trimmed.includes('?')) {
    // Directory prefix match: "src/old" matches "src/old/foo.ts"
    return (fp: string) => fp === trimmed || fp.startsWith(trimmed + '/') || fp.startsWith(trimmed.replace(/\/$/, '') + '/');
  }

  // Convert glob to regex
  let regexStr = '^';
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '*') {
      if (trimmed[i + 1] === '*') {
        // ** matches anything including path separators
        if (trimmed[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  regexStr += '$';

  const regex = new RegExp(regexStr);
  return (fp: string) => regex.test(fp);
}
