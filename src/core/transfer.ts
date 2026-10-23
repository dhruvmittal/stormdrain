import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { ConfigManager } from './config';
import { ContextManager } from './context';
import { parseMemory, serializeMemory } from './memory';
import { getContextsPath, getContextMemoriesPath, ensureDirectories } from '../utils/paths';
import {
  ContextConfig,
  Memory,
  MemoryRelation,
  RelationType,
  StormDrainSettings,
  toCanonicalType,
} from '../types';

export type ImportStrategy = 'merge' | 'overwrite' | 'skip';

export interface ExportedContextBundle {
  config: ContextConfig;
  memories: Memory[];
}

export interface StormDrainBundle {
  format: 'stormdrain-bundle';
  version: 1;
  exportedAt: string;
  scope: 'context' | 'all';
  activeContext?: string;
  settings?: StormDrainSettings;
  contexts: Record<string, ExportedContextBundle>;
}

export interface ExportOptions {
  contexts?: string[];
  all?: boolean;
  includeCodemaps?: boolean;
}

export interface ImportOptions {
  strategy?: ImportStrategy;
  contexts?: string[];
  targetContextName?: string;
  bindPaths?: string[];
  includeCodemaps?: boolean;
  importSettings?: boolean;
  syncBoundWorkspaces?: boolean;
}

export interface ContextImportStats {
  context: string;
  sourceContext: string;
  added: number;
  updated: number;
  skipped: number;
  boundPaths: string[];
  scannedFiles: number;
}

export interface ImportResult {
  scope: 'context' | 'all';
  strategy: ImportStrategy;
  settingsImported: boolean;
  contexts: ContextImportStats[];
  totalAdded: number;
  totalUpdated: number;
  totalSkipped: number;
}

/**
 * Normalize and validate a context name, preventing path traversal.
 */
export function normalizeContextName(raw: string): string {
  const trimmed = String(raw || '').trim();
  const normalized = trimmed === 'global' ? '_global' : trimmed;
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`Invalid context name "${raw}". Context names may only contain letters, numbers, underscores, and hyphens.`);
  }
  return normalized;
}

/**
 * Sanitize and validate a memory ID, returning null if malformed or unsafe.
 */
function sanitizeMemoryId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim().replace(/\.md$/i, '');
  if (!trimmed || trimmed === '.' || trimmed === '..' || !/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function isCodemapMemory(meta: { id: string; type: string }): boolean {
  return meta.type === 'codemap' || meta.id.startsWith('file_');
}

function pickIsoTimestamp(a: string | undefined, b: string | undefined, mode: 'min' | 'max', fallback: string): string {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (!isNaN(ta) && !isNaN(tb)) {
    return (mode === 'min' ? ta <= tb : ta >= tb) ? a! : b!;
  }
  if (!isNaN(ta)) return a!;
  if (!isNaN(tb)) return b!;
  return fallback;
}

/**
 * Read all memories for a given context purely from its canonical Markdown files on disk
 * (100% read-only; never creates directories or spawns Git subprocesses).
 */
function readContextMemories(contextName: string, includeCodemaps: boolean): Memory[] {
  const memDir = getContextMemoriesPath(contextName);
  if (!fs.existsSync(memDir)) {
    return [];
  }

  const memoriesById = new Map<string, Memory>();
  const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort();

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(memDir, file), 'utf8');
      const mem = parseMemory(raw);
      const safeId = sanitizeMemoryId(mem?.metadata?.id);
      if (!safeId) continue;
      mem.metadata.id = safeId;
      if (!includeCodemaps && isCodemapMemory(mem.metadata)) {
        continue;
      }
      memoriesById.set(safeId, mem);
    } catch {
      // Ignore malformed files
    }
  }

  return Array.from(memoriesById.values()).sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));
}

/**
 * Export either specific context(s) or the entire StormDrain instance into a portable bundle.
 */
export function exportBundle(options: ExportOptions = {}): StormDrainBundle {
  const config = new ConfigManager();
  const includeCodemaps = options.includeCodemaps ?? true;
  const isAll = Boolean(options.all);

  const registeredContexts = config.getContexts();
  let targetNames: string[] = [];

  if (isAll) {
    const names = new Set<string>(Object.keys(registeredContexts));
    const contextsRoot = getContextsPath();
    if (fs.existsSync(contextsRoot)) {
      for (const entry of fs.readdirSync(contextsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name)) {
          names.add(entry.name);
        }
      }
    }
    targetNames = Array.from(names).sort();
  } else {
    const requested = (options.contexts || [])
      .map(c => String(c || '').trim())
      .filter(Boolean)
      .map(normalizeContextName);

    if (requested.length === 0) {
      throw new Error('Must specify at least one context name or set "all: true" to export.');
    }
    for (const name of requested) {
      const ctxCfg = config.getContext(name);
      const ctxDir = path.join(getContextsPath(), name);
      if (!ctxCfg && !fs.existsSync(ctxDir)) {
        throw new Error(`Context "${name}" does not exist.`);
      }
      if (!targetNames.includes(name)) {
        targetNames.push(name);
      }
    }
  }

  const exportedContexts: Record<string, ExportedContextBundle> = {};
  for (const name of targetNames) {
    const existingCfg = config.getContext(name) || {
      name,
      paths: [],
      parent: null,
    };
    const memories = readContextMemories(name, includeCodemaps);
    exportedContexts[name] = {
      config: {
        name: existingCfg.name,
        paths: [...(existingCfg.paths || [])],
        parent: existingCfg.parent ?? null,
      },
      memories,
    };
  }

  return {
    format: 'stormdrain-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: isAll ? 'all' : 'context',
    ...(isAll ? {
      activeContext: config.getActiveContext(),
      settings: config.getSettings(),
    } : {}),
    contexts: exportedContexts,
  };
}

/**
 * Serialize a bundle to a Buffer (plain UTF-8 JSON or Gzipped JSON).
 */
export function serializeBundleBuffer(bundle: StormDrainBundle, gzip: boolean = false): Buffer {
  const jsonStr = JSON.stringify(bundle, null, 2);
  const rawBuf = Buffer.from(jsonStr, 'utf8');
  return gzip ? zlib.gzipSync(rawBuf) : rawBuf;
}

/**
 * Parse a bundle from a Buffer or string (automatically detecting Gzip magic bytes 0x1f 0x8b).
 */
export function parseBundleBuffer(input: Buffer | string): StormDrainBundle {
  let jsonStr: string;
  if (Buffer.isBuffer(input)) {
    const isGzip = input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b;
    const decoded = isGzip ? zlib.gunzipSync(input) : input;
    jsonStr = decoded.toString('utf8');
  } else {
    jsonStr = input;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    throw new Error(`Failed to parse StormDrain bundle JSON: ${err.message}`);
  }

  if (!parsed || parsed.format !== 'stormdrain-bundle' || typeof parsed.contexts !== 'object' || !parsed.contexts) {
    throw new Error('Invalid bundle format: expected a StormDrain export bundle ("format": "stormdrain-bundle").');
  }

  return parsed as StormDrainBundle;
}

/**
 * Merge two memories sharing the same ID using timestamp precedence and tag/relation union,
 * while keeping consolidation state ('consolidated' tag + superseded_by) strictly coupled to the winner.
 */
function mergeMemoryPair(existing: Memory, incoming: Memory, targetContextName: string): { merged: Memory; changed: boolean } {
  const nowIso = new Date().toISOString();
  const existingTime = Date.parse(existing.metadata.updated || existing.metadata.created || '') || 0;
  const incomingTime = Date.parse(incoming.metadata.updated || incoming.metadata.created || '') || 0;
  const incomingWins = incomingTime >= existingTime;

  const winner = incomingWins ? incoming : existing;
  const loser = incomingWins ? existing : incoming;

  const winnerConsolidated = Boolean(winner.metadata.superseded_by) || (winner.metadata.tags || []).includes('consolidated');
  const loserTagsFiltered = (loser.metadata.tags || []).filter(t => winnerConsolidated || t !== 'consolidated');
  const mergedTags = Array.from(new Set([...(winner.metadata.tags || []), ...loserTagsFiltered]));

  // If the winning snapshot was consolidated/superseded, preserve its exact relations (e.g., part_of)
  // so pre-consolidation edges are not resurrected; otherwise union relations, omitting part_of
  // edges from a consolidated loser so zombie consolidation pointers are not resurrected.
  let mergedRelations: MemoryRelation[];
  if (winnerConsolidated) {
    mergedRelations = [...(winner.metadata.relations || [])];
  } else {
    const relMap = new Map<string, MemoryRelation>();
    const loserRelations = (loser.metadata.relations || []).filter(r => winnerConsolidated || r.type !== 'part_of');
    for (const r of [...(winner.metadata.relations || []), ...loserRelations]) {
      if (r && typeof r.target === 'string' && r.target.trim()) {
        relMap.set(`${r.target}:${r.type}`, { target: r.target, type: r.type });
      }
    }
    mergedRelations = Array.from(relMap.values());
  }

  const merged: Memory = {
    metadata: {
      ...winner.metadata,
      context: targetContextName,
      type: toCanonicalType(winner.metadata.type),
      tags: mergedTags,
      relations: mergedRelations,
      superseded_by: winnerConsolidated ? (winner.metadata.superseded_by ?? null) : null,
      created: pickIsoTimestamp(existing.metadata.created, incoming.metadata.created, 'min', nowIso),
      updated: pickIsoTimestamp(existing.metadata.updated, incoming.metadata.updated, 'max', nowIso),
      accessed: pickIsoTimestamp(existing.metadata.accessed, incoming.metadata.accessed, 'max', nowIso),
      access_count: Math.max(existing.metadata.access_count ?? 0, incoming.metadata.access_count ?? 0),
      is_canonical: Boolean((existing.metadata.is_canonical ?? true) || (incoming.metadata.is_canonical ?? true)),
    },
    content: winner.content,
  };

  const changed = serializeMemory(existing) !== serializeMemory(merged);
  return { merged, changed };
}

/**
 * Import a StormDrainBundle into the local StormDrain storage.
 */
export async function importBundle(bundle: StormDrainBundle, options: ImportOptions = {}): Promise<ImportResult> {
  const strategy: ImportStrategy = options.strategy || 'merge';
  if (!['merge', 'overwrite', 'skip'].includes(strategy)) {
    throw new Error(`Invalid import strategy "${strategy}". Allowed strategies: merge, overwrite, skip.`);
  }

  const includeCodemaps = options.includeCodemaps ?? true;
  const shouldImportSettings = options.importSettings ?? (bundle.scope === 'all');
  const config = new ConfigManager();

  const availableContextNames = Object.keys(bundle.contexts || {});
  if (availableContextNames.length === 0) {
    throw new Error('Bundle contains no contexts to import.');
  }

  let selectedSourceContexts = availableContextNames;
  if (options.contexts && options.contexts.length > 0) {
    const requested = options.contexts.map(c => String(c || '').trim()).filter(Boolean).map(normalizeContextName);
    for (const req of requested) {
      if (!bundle.contexts[req]) {
        throw new Error(`Context "${req}" not found in bundle. Available contexts: ${availableContextNames.join(', ')}`);
      }
    }
    selectedSourceContexts = requested;
  }

  if (options.targetContextName && selectedSourceContexts.length > 1) {
    throw new Error('Cannot use "--as <target_context>" when importing multiple contexts simultaneously.');
  }
  if (options.bindPaths && options.bindPaths.length > 0 && selectedSourceContexts.length > 1) {
    throw new Error('Cannot use "--bind <path>" when importing multiple contexts simultaneously. Specify a single context with "-c <context>".');
  }

  // Validate all target context names upfront before mutating config or disk
  const sourceToTargetMap = new Map<string, string>();
  for (const sourceCtxName of selectedSourceContexts) {
    const targetName = options.targetContextName
      ? normalizeContextName(options.targetContextName)
      : normalizeContextName(sourceCtxName);
    sourceToTargetMap.set(sourceCtxName, targetName);
  }

  let settingsImported = false;
  if (shouldImportSettings && bundle.settings) {
    config.updateSettings(bundle.settings);
    settingsImported = true;
  }

  // Pass 1: Ensure all target contexts exist in ConfigManager (with parent: null initially)
  for (const sourceCtxName of selectedSourceContexts) {
    const targetName = sourceToTargetMap.get(sourceCtxName)!;
    if (targetName !== '_global' && !config.getContext(targetName)) {
      config.addContext(targetName, [], null);
    }
  }

  // Pass 2: Wire up parent context links now that all imported contexts are registered
  for (const sourceCtxName of selectedSourceContexts) {
    const targetName = sourceToTargetMap.get(sourceCtxName)!;
    const rawParent = bundle.contexts[sourceCtxName]?.config?.parent;
    if (targetName !== '_global' && rawParent) {
      try {
        const normParent = normalizeContextName(rawParent);
        config.setContextParent(targetName, normParent);
      } catch {
        // Ignore invalid parent names
      }
    }
  }

  const statsList: ContextImportStats[] = [];
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const sourceCtxName of selectedSourceContexts) {
    const ctxBundle = bundle.contexts[sourceCtxName];
    const targetName = sourceToTargetMap.get(sourceCtxName)!;

    // Bind any existing absolute source paths on this machine plus explicit --bind paths
    const explicitBindPaths = (options.bindPaths || []).map(p => p.trim()).filter(Boolean);
    const candidatePaths = [
      ...(ctxBundle.config?.paths || []).filter(p => p && path.isAbsolute(p) && fs.existsSync(p)),
      ...explicitBindPaths,
    ];
    for (const bp of candidatePaths) {
      try {
        config.bindPathToContext(targetName, path.resolve(bp));
      } catch {
        // Ignore unbindable host paths
      }
    }

    ensureDirectories(targetName);
    const ctx = new ContextManager(targetName);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let scannedFiles = 0;

    try {
      const db = ctx.getDb();
      const incomingMemories = ctxBundle.memories || [];
      const nowIso = new Date().toISOString();

      const runImportTx = db.transaction(() => {
        for (const rawIncoming of incomingMemories) {
          const safeId = sanitizeMemoryId(rawIncoming?.metadata?.id);
          if (!safeId) {
            skipped++;
            continue;
          }

          const incomingMeta = rawIncoming.metadata;
          if (!includeCodemaps && isCodemapMemory({ id: safeId, type: String(incomingMeta.type || '') })) {
            continue;
          }

          const sanitizedRelations = Array.isArray(incomingMeta.relations)
            ? incomingMeta.relations
                .filter(r => r && typeof r.target === 'string' && r.target.trim())
                .map(r => ({ target: r.target.trim(), type: (r.type || 'related_to') as RelationType }))
            : [];

          const normalizedIncoming: Memory = {
            metadata: {
              ...incomingMeta,
              id: safeId,
              title: String(incomingMeta.title ?? safeId),
              context: targetName,
              type: toCanonicalType(String(incomingMeta.type || 'fact')),
              confidence: typeof incomingMeta.confidence === 'number' ? incomingMeta.confidence : 1.0,
              created: incomingMeta.created || nowIso,
              updated: incomingMeta.updated || incomingMeta.created || nowIso,
              accessed: incomingMeta.accessed || nowIso,
              access_count: typeof incomingMeta.access_count === 'number' ? incomingMeta.access_count : 0,
              source: incomingMeta.source || 'manual',
              expires: incomingMeta.expires ?? null,
              superseded_by: incomingMeta.superseded_by ?? null,
              tags: Array.isArray(incomingMeta.tags) ? incomingMeta.tags.map(String) : [],
              relations: sanitizedRelations,
              git_branch: incomingMeta.git_branch ?? null,
              is_canonical: incomingMeta.is_canonical ?? true,
            },
            content: typeof rawIncoming.content === 'string' ? rawIncoming.content : '',
          };

          const existing = ctx.getMemory(safeId);
          if (!existing) {
            ctx.saveMemory(normalizedIncoming, `[stormdrain] import: add ${safeId}`);
            added++;
          } else if (strategy === 'overwrite') {
            ctx.saveMemory(normalizedIncoming, `[stormdrain] import: overwrite ${safeId}`);
            updated++;
          } else if (strategy === 'merge') {
            const { merged, changed } = mergeMemoryPair(existing, normalizedIncoming, targetName);
            if (changed) {
              ctx.saveMemory(merged, `[stormdrain] import: merge ${safeId}`);
              updated++;
            } else {
              skipped++;
            }
          } else {
            skipped++;
          }
        }
      });

      runImportTx();

      // Integrity check: If any memory has a superseded_by target that does not exist in memories,
      // heal it by clearing superseded_by and removing the 'consolidated' tag so it doesn't stay
      // permanently hidden as an orphan micro-memory without a parent.
      const danglingRows = db.prepare(`
        SELECT id FROM memories
        WHERE superseded_by IS NOT NULL
          AND superseded_by != ''
          AND superseded_by NOT IN (SELECT id FROM memories)
      `).all() as Array<{ id: string }>;

      for (const row of danglingRows) {
        const dMem = ctx.getMemory(row.id);
        if (dMem) {
          const oldSuperseded = dMem.metadata.superseded_by;
          dMem.metadata.superseded_by = null;
          dMem.metadata.tags = (dMem.metadata.tags || []).filter(t => t !== 'consolidated');
          if (oldSuperseded) {
            dMem.metadata.relations = (dMem.metadata.relations || []).filter(r => r.target !== oldSuperseded);
          }
          ctx.saveMemory(dMem, `[stormdrain] import: heal dangling superseded_by on ${row.id}`);
        }
      }

      // If explicit --bind paths were provided (and syncBoundWorkspaces is not disabled),
      // auto-sync the file graph so codemap vertices and import edges are immediately available.
      const shouldScan = options.syncBoundWorkspaces ?? (explicitBindPaths.length > 0);
      if (shouldScan) {
        for (const bp of explicitBindPaths) {
          const resolvedBp = path.resolve(bp);
          if (ConfigManager.isSystemOrHomeRoot(resolvedBp)) continue;
          if (fs.existsSync(resolvedBp) && fs.statSync(resolvedBp).isDirectory()) {
            const scanRes = ctx.syncFileGraph(resolvedBp);
            scannedFiles += scanRes.createdCount;
          }
        }
      }
    } finally {
      await ctx.close();
    }

    const finalCtxCfg = config.getContext(targetName);
    statsList.push({
      context: targetName,
      sourceContext: sourceCtxName,
      added,
      updated,
      skipped,
      boundPaths: finalCtxCfg?.paths || [],
      scannedFiles,
    });

    totalAdded += added;
    totalUpdated += updated;
    totalSkipped += skipped;
  }

  // Restore activeContext if importing settings from a full bundle and the activeContext exists locally
  if (
    shouldImportSettings &&
    bundle.scope === 'all' &&
    bundle.activeContext &&
    (bundle.activeContext === '_global' || config.getContext(bundle.activeContext))
  ) {
    try {
      config.setActiveContext(bundle.activeContext);
    } catch {}
  }

  return {
    scope: bundle.scope,
    strategy,
    settingsImported,
    contexts: statsList,
    totalAdded,
    totalUpdated,
    totalSkipped,
  };
}
