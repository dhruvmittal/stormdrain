import express from 'express';
import cors from 'cors';
import compression from 'compression';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { FileReader } from '../core/reader';
import { MultiHopMemoryResult, MemoryType } from '../types';
import { normalizeRepoPath } from '../utils/fileGraphScanner';
import { scaffoldAgentsMd } from '../utils/agentsScaffolder';
import { generateCuratePrompt, generateHarvestPrompt } from '../utils/promptTemplates';

export const startWebServer = (port: number = 3456, host: string = process.env.STORMDRAIN_HOST || '127.0.0.1') => {
  const app = express();

  const allowedOriginPatterns = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^http:\/\/\[::1\](:\d+)?$/
  ];
  if (host && host !== '127.0.0.1' && host !== 'localhost') {
    allowedOriginPatterns.push(new RegExp(`^http://${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(:\\d+)?$`));
  }
  const customOrigins = process.env.STORMDRAIN_ALLOWED_ORIGINS
    ? process.env.STORMDRAIN_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const isOriginAllowed = (origin?: string): boolean => {
    if (!origin) return true; // Non-browser clients (curl, thin python agent, MCP stdio)
    if (customOrigins.includes(origin)) return true;
    return allowedOriginPatterns.some(pattern => pattern.test(origin));
  };

  app.use(cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  }));

  // CSRF protection: block cross-origin state-mutating requests from unauthorized browser origins
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !isOriginAllowed(origin)) {
        res.status(403).json({ error: 'Cross-origin mutation forbidden' });
        return;
      }
    }
    next();
  });

  app.use(compression());
  app.use(express.json());

  const config = new ConfigManager();
  const contextCache = new Map<string, ContextManager>();
  const MAX_CONTEXT_CACHE = 50;

  const isValidContextName = (name: string): boolean => {
    return /^[a-zA-Z0-9_-]+$/.test(name);
  };

  const getContext = (name: string): ContextManager => {
    let ctx = contextCache.get(name);
    if (ctx) {
      contextCache.delete(name);
      contextCache.set(name, ctx);
      return ctx;
    }
    if (contextCache.size >= MAX_CONTEXT_CACHE) {
      const oldestKey = contextCache.keys().next().value;
      if (oldestKey) {
        const oldestCtx = contextCache.get(oldestKey);
        try { oldestCtx?.close(); } catch {}
        contextCache.delete(oldestKey);
      }
    }
    ctx = new ContextManager(name);
    contextCache.set(name, ctx);
    return ctx;
  };

  // Helper middleware wrapper
  const withContext = (handler: (req: express.Request, res: express.Response, ctx: ContextManager) => Promise<void>) => {
    return async (req: express.Request, res: express.Response) => {
      const rawContext = req.query.context ? String(req.query.context) : undefined;
      if (rawContext !== undefined && !isValidContextName(rawContext)) {
        res.status(400).json({ error: 'Invalid context name: must contain only alphanumeric characters, dashes, or underscores' });
        return;
      }
      const active = rawContext || config.getActiveContext();
      try {
        const ctx = getContext(active);
        await handler(req, res, ctx);
      } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    };
  };

  app.get('/api/contexts', (req, res) => {
    res.json({
      active: config.getActiveContext(),
      contexts: config.getContexts()
    });
  });

  app.post('/api/contexts/use', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !isValidContextName(name)) {
      res.status(400).json({ error: 'Invalid context name: must contain only alphanumeric characters, dashes, or underscores' });
      return;
    }
    try {
      config.setActiveContext(name);
      res.json({ success: true, active: name });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/contexts/:name', (req, res) => {
    const name = req.params.name ? String(req.params.name) : '';
    if (!name || !isValidContextName(name)) {
      res.status(400).json({ error: 'Invalid context name: must contain only alphanumeric characters, dashes, or underscores' });
      return;
    }
    try {
      // Close cached context manager before deletion
      const cached = contextCache.get(name);
      if (cached) {
        cached.close();
        contextCache.delete(name);
      }
      config.deleteContext(name, true);
      res.json({ success: true, active: config.getActiveContext() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/init', async (req, res) => {
    try {
      const { name, directory, submodule_policy } = req.body || {};
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Context name is required' });
        return;
      }
      if (!isValidContextName(name)) {
        res.status(400).json({ error: 'Invalid context name: must contain only alphanumeric characters, dashes, or underscores' });
        return;
      }
      let dir = directory ? path.resolve(String(directory)) : process.cwd();
      if (ConfigManager.isSystemOrHomeRoot(dir) && name !== '_global') {
        res.status(400).json({ error: `Cannot initialize context "${name}" on root or home directory "${dir}". Please specify a project sub-directory.` });
        return;
      }

      const existing = config.getContext(name);
      if (!existing) {
        config.addContext(name, [dir]);
      } else {
        config.bindPathToContext(name, dir);
      }
      config.setActiveContext(name);

      scaffoldAgentsMd(dir);

      const targetCtx = getContext(name);
      const submodulePolicy = (submodule_policy as 'dive' | 'sum') || 'sum';
      const { createdCount } = targetCtx.syncFileGraph(dir, { submodulePolicies: submodulePolicy });

      res.json({
        success: true,
        name,
        directory: dir,
        createdCount
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/config', (req, res) => {
    try {
      res.json(config.getSettings());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/config', (req, res) => {
    try {
      const updated = config.updateSettings(req.body);
      res.json({ success: true, settings: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/config/reset', (req, res) => {
    try {
      const reset = config.resetSettings();
      res.json({ success: true, settings: reset });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  app.get('/api/stats', withContext(async (req, res, ctx) => {
    const db = ctx.getDb();

    // Total & Active counts
    const totalRow = db.prepare(`SELECT COUNT(*) as total, AVG(confidence) as avg_conf FROM memories WHERE type != 'codemap' AND superseded_by IS NULL`).get() as { total: number; avg_conf: number | null };
    const avgConfidence = totalRow?.avg_conf !== null && totalRow?.avg_conf !== undefined ? Math.round(totalRow.avg_conf * 1000) / 10 : 100;

    // Type counts breakdown
    const typeRows = db.prepare(`SELECT type, COUNT(*) as count FROM memories GROUP BY type`).all() as Array<{ type: string; count: number }>;
    const counts: Record<string, number> = { total: 0, concept: 0, pattern: 0, guide: 0, lesson: 0, fact: 0, warning: 0, codemap: 0, sequence: 0 };
    typeRows.forEach(r => {
      counts[r.type] = r.count;
      if (r.type !== 'codemap') counts.total += r.count;
    });

    // Time calculations
    const now = new Date();
    const iso24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const iso7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const iso30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const velocity24h = (db.prepare(`SELECT COUNT(*) as count FROM memories WHERE created >= ? OR updated >= ?`).get(iso24h, iso24h) as any)?.count || 0;
    const velocity7d = (db.prepare(`SELECT COUNT(*) as count FROM memories WHERE created >= ? OR updated >= ?`).get(iso7d, iso7d) as any)?.count || 0;
    const velocity30d = (db.prepare(`SELECT COUNT(*) as count FROM memories WHERE created >= ? OR updated >= ?`).get(iso30d, iso30d) as any)?.count || 0;

    // Consolidation Backlog
    const candidates = ctx.findConsolidationCandidates();
    const backlogCount = candidates.length;
    const unconsolidatedCount = candidates.reduce((acc, c) => acc + c.memoryCount, 0);

    // Decay Watchlist (memories with confidence < 0.9, ascending)
    const decayWatchlist = db.prepare(`
      SELECT id, type, title, confidence, updated 
      FROM memories 
      WHERE type != 'codemap' AND superseded_by IS NULL AND confidence < 0.9 
      ORDER BY confidence ASC, updated DESC 
      LIMIT 5
    `).all();

    // Top Knowledge Hotspots (files/codemaps with the most linked non-codemap memories)
    const hotspots = db.prepare(`
      SELECT m.id, m.title, COUNT(r.source_id) as attached_count 
      FROM memories m 
      JOIN relations r ON r.target_id = m.id OR r.source_id = m.id
      JOIN memories m2 ON (m2.id = r.source_id OR m2.id = r.target_id) AND m2.id != m.id
      WHERE m.type = 'codemap' AND m2.type != 'codemap'
      GROUP BY m.id 
      ORDER BY attached_count DESC 
      LIMIT 5
    `).all();

    // Codebase Coverage
    const totalCodemaps = (db.prepare(`SELECT COUNT(*) as count FROM memories WHERE type = 'codemap'`).get() as any)?.count || 0;
    const coveredCodemaps = (db.prepare(`
      SELECT COUNT(DISTINCT m.id) as count 
      FROM memories m 
      JOIN relations r ON (r.target_id = m.id OR r.source_id = m.id)
      JOIN memories m2 ON (m2.id = r.source_id OR m2.id = r.target_id) AND m2.id != m.id
      WHERE m.type = 'codemap' AND m2.type != 'codemap'
    `).get() as any)?.count || 0;

    // Recent Activity
    const recentActivity = db.prepare(`
      SELECT id, type, title, confidence, updated, created, source 
      FROM memories 
      WHERE type != 'codemap' 
      ORDER BY updated DESC 
      LIMIT 5
    `).all();

    res.json({
      graphHealthScore: avgConfidence,
      counts,
      velocity: {
        last24h: velocity24h,
        last7d: velocity7d,
        last30d: velocity30d
      },
      backlog: {
        candidateCount: backlogCount,
        unconsolidatedCount,
        candidates
      },
      decayWatchlist,
      hotspots,
      codebaseCoverage: {
        totalCodemaps,
        coveredCodemaps,
        percentage: totalCodemaps > 0 ? Math.round((coveredCodemaps / totalCodemaps) * 100) : 0
      },
      recentActivity
    });
  }));

  app.get('/api/memories', withContext(async (req, res, ctx) => {
    const query = req.query.q ? String(req.query.q).trim() : '';
    const branch = (req.query.branch || req.headers['x-stormdrain-branch']) as string | undefined;
    const type = req.query.type as MemoryType | undefined;
    const unpromotedOnly = req.query.unpromoted === 'true' || req.query.unpromoted === '1';

    if (query || branch || type || unpromotedOnly) {
      const results = ctx.searchMemories(query, true, { branch, type, unpromotedOnly });
      res.json(results);
    } else {
      const memories = ctx.getDb().prepare(`SELECT id, type, title, confidence, created, updated, accessed, access_count, source, git_branch, is_canonical FROM memories ORDER BY updated DESC`).all();
      res.json(memories);
    }
  }));

  app.post('/api/memories', withContext(async (req, res, ctx) => {
    const { type, title, content, tags, target, targets, targetFile, relationType, relations, gitBranch, git_branch, isCanonical, is_canonical } = req.body;
    if (!type || !title || !content) {
      res.status(400).json({ error: 'Missing required fields: type, title, and content are required' });
      return;
    }
    try {
      const targetArg = targets || target || targetFile;
      const branchHeader = req.headers['x-stormdrain-branch'] as string | undefined;
      const explicitBranch = gitBranch !== undefined ? gitBranch : git_branch;
      const effectiveBranch = explicitBranch !== undefined ? explicitBranch : (branchHeader || null);
      const effectiveCanonical = isCanonical !== undefined ? Boolean(isCanonical) : (is_canonical !== undefined ? Boolean(is_canonical) : undefined);

      const id = ctx.addMemory(
        type,
        title,
        content,
        tags || [],
        'manual',
        undefined,
        targetArg,
        relationType || 'affects',
        relations,
        effectiveBranch,
        effectiveCanonical
      );
      res.status(201).json({ success: true, id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.get('/api/memories/:id', withContext(async (req, res, ctx) => {
    const id = req.params.id ? String(req.params.id) : '';
    const memory = ctx.getMemory(id);
    if (!memory) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(memory);
  }));

  app.get('/api/memories/:id/relations', withContext(async (req, res, ctx) => {
    const id = req.params.id ? String(req.params.id) : '';
    try {
      const relations = ctx.getRelations(id);
      res.json(relations);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.put('/api/memories/:id', withContext(async (req, res, ctx) => {
    const id = req.params.id ? String(req.params.id) : '';
    const {
      title, content, tags, type, relations,
      addRelations, removeRelations, add_relations, remove_relations,
      addTargets, removeTargets, add_targets, remove_targets,
      is_canonical, isCanonical, git_branch, gitBranch
    } = req.body;
    try {
      ctx.updateMemory(id, content, title, tags, type, {
        relations,
        addRelations: addRelations || add_relations,
        removeRelations: removeRelations || remove_relations,
        addTargets: addTargets || add_targets,
        removeTargets: removeTargets || remove_targets,
        is_canonical: is_canonical !== undefined ? Boolean(is_canonical) : (isCanonical !== undefined ? Boolean(isCanonical) : undefined),
        git_branch: git_branch !== undefined ? git_branch : gitBranch
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.get('/api/branches', withContext(async (req, res, ctx) => {
    try {
      res.json({ branches: ctx.getBranches() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.post('/api/branches/promote', withContext(async (req, res, ctx) => {
    const branch = req.body.branch || req.query.branch;
    if (!branch) {
      res.status(400).json({ error: 'Field "branch" is required in request body or query' });
      return;
    }
    try {
      const count = ctx.promoteBranch(String(branch));
      res.json({ success: true, branch, promotedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.delete('/api/memories/:id', withContext(async (req, res, ctx) => {
    const id = req.params.id ? String(req.params.id) : '';
    try {
      ctx.deleteMemory(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.get('/api/nodes/:id', withContext(async (req, res, ctx) => {
    const id = req.params.id ? String(req.params.id) : '';
    try {
      const details = ctx.getNodeDetails(id);
      if (!details) {
        res.status(404).json({ error: `Node "${id}" not found` });
        return;
      }
      res.json(details);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.get('/api/recall', withContext(async (req, res, ctx) => {
    try {
      const target = (req.query.target || req.query.targetFile || req.query.file) as string | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
      const rawDepth = req.query.depth || req.query.max_depth || req.query.maxDepth;
      const depth = rawDepth ? parseInt(String(rawDepth), 10) : 3;
      const branch = (req.query.branch || req.headers['x-stormdrain-branch']) as string | undefined;

      if (target) {
        const normTarget = normalizeRepoPath(target, ctx.getWorkspaceRoots());
        const multiHop = ctx.recallMultiHop(normTarget, {
          maxDepth: isNaN(depth) ? 3 : depth,
          maxResults: isNaN(limit) ? 10 : limit,
          cumulativeThreshold: 0.98,
          branch: branch || undefined
        });

        if (multiHop.all.length === 0) {
          res.json({
            target: normTarget,
            count: 0,
            text: `No memories found for target file "${normTarget}" or its topological neighborhood.`,
            results: multiHop,
          });
          return;
        }

        const sections: string[] = [];

        if (multiHop.direct.length > 0) {
          sections.push(`### 🎯 Direct File Invariants (${normTarget})`);
          for (const r of multiHop.direct) {
            const mem = ctx.getMemory(r.id);
            sections.push(`- **[${r.type.toUpperCase()}] ${r.title}** (ID: \`${r.id}\`, Score: ${r.relevanceScore})\n${mem?.content || ''}`);
          }
        }

        if (multiHop.upstream.length > 0) {
          sections.push(`### ⚠️ Upstream Consumer Constraints (Callers at Risk)`);
          for (const r of multiHop.upstream) {
            const mem = ctx.getMemory(r.id);
            const fileLabel = r.targetFile ? ` [via ${r.targetFile}, Hop ${r.depth}]` : '';
            sections.push(`- **[${r.type.toUpperCase()}] ${r.title}** (ID: \`${r.id}\`${fileLabel}, Score: ${r.relevanceScore})\n${mem?.content || ''}`);
          }
        }

        if (multiHop.downstream.length > 0) {
          sections.push(`### 📦 Downstream Dependency Invariants (Foundations)`);
          for (const r of multiHop.downstream) {
            const mem = ctx.getMemory(r.id);
            const fileLabel = r.targetFile ? ` [via ${r.targetFile}, Hop ${r.depth}]` : '';
            sections.push(`- **[${r.type.toUpperCase()}] ${r.title}** (ID: \`${r.id}\`${fileLabel}, Score: ${r.relevanceScore})\n${mem?.content || ''}`);
          }
        }

        res.json({
          target: normTarget,
          count: multiHop.all.length,
          text: sections.join('\n\n'),
          results: multiHop,
        });
      } else {
        const topMemories = ctx.recallTopMemories(isNaN(limit) ? 10 : limit) as Array<{
          type: string;
          title: string;
          id: string;
          confidence: number;
        }>;

        const content = topMemories.map((r) => {
          const mem = ctx.getMemory(r.id);
          return `## [${r.type.toUpperCase()}] ${r.title} (ID: ${r.id})\n${mem?.content || ''}\n---`;
        }).join('\n\n');

        res.json({
          count: topMemories.length,
          text: content || 'No memories found.',
          memories: topMemories,
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.get('/api/invariants', withContext(async (req, res, ctx) => {
    try {
      const rawTarget = (req.query.target || req.query.targetFile || req.query.path) as string;
      if (!rawTarget) {
        res.status(400).json({ error: 'target parameter is required' });
        return;
      }
      const target = normalizeRepoPath(rawTarget, ctx.getWorkspaceRoots());
      const tokenBudget = req.query.tokenBudget ? parseInt(String(req.query.tokenBudget), 10) : 500;
      const hops = req.query.maxHops ? parseInt(String(req.query.maxHops), 10) : 2;
      const branch = ((req.query.branch || req.headers['x-stormdrain-branch']) as string) || undefined;

      let graphResults = ctx.recallGraph(target, isNaN(hops) ? 2 : hops, branch);
      if (graphResults.length === 0 && path.basename(target) !== target) {
        const baseNameRes = ctx.recallGraph(path.basename(target), isNaN(hops) ? 2 : hops, branch);
        if (baseNameRes.length > 0) {
          graphResults = baseNameRes;
        }
      }

      const fileReader = new FileReader(config);
      const header = fileReader.formatInvariantHeader(
        target,
        graphResults as MultiHopMemoryResult[],
        isNaN(tokenBudget) ? 500 : tokenBudget
      );

      res.json({
        target,
        count: graphResults.length,
        header,
        memories: graphResults,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.get('/api/consolidation-candidates', withContext(async (req, res, ctx) => {
    try {
      const thresholdParam = req.query.threshold ? Number(req.query.threshold) : undefined;
      const candidates = ctx.findConsolidationCandidates(thresholdParam);
      res.json(candidates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.post('/api/consolidate', withContext(async (req, res, ctx) => {
    const { targetFile, target, memoryIds } = req.body;
    const targetPath = targetFile || target;
    if (!targetPath) {
      res.status(400).json({ error: 'targetFile or target is required' });
      return;
    }
    try {
      const result = ctx.consolidateNeighborhood(targetPath, { memory_ids: memoryIds });
      if (!result.consolidatedId) {
        res.status(400).json({ error: 'At least 2 micro-memories are required to consolidate' });
        return;
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.post('/api/relations', withContext(async (req, res, ctx) => {
    const { source, target, type } = req.body;
    if (!source || !target) {
      res.status(400).json({ error: 'source and target are required' });
      return;
    }
    try {
      const added = ctx.addRelation(source, target, type || 'related_to');
      res.json({ success: true, added });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.delete('/api/relations', withContext(async (req, res, ctx) => {
    const { source, target, type } = req.body;
    if (!source || !target) {
      res.status(400).json({ error: 'source and target are required' });
      return;
    }
    try {
      const removed = ctx.removeRelation(source, target, type);
      res.json({ success: true, removed });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }));

  app.post('/api/scan', withContext(async (req, res, ctx) => {
    try {
      let dir = req.body?.directory || (req.query.directory ? String(req.query.directory) : undefined);
      const targetContext = ctx.getContextName();
      if (!dir) {
        const ctxConfig = config.getContext(targetContext);
        const validBound = ctxConfig?.paths?.find(p => !ConfigManager.isSystemOrHomeRoot(p));
        if (validBound && fs.existsSync(validBound)) {
          dir = validBound;
        } else if (!ConfigManager.isSystemOrHomeRoot(process.cwd())) {
          dir = process.cwd();
        } else {
          res.status(400).json({ error: 'No workspace directory specified for scan, and current working directory is home/root directory.' });
          return;
        }
      }
      dir = path.resolve(dir);
      const submodulePolicy = (req.body?.submodule_policy || req.query.submodule_policy || 'sum') as 'dive' | 'sum';
      const { createdCount, decayedCount } = ctx.syncFileGraph(dir, { submodulePolicies: submodulePolicy });
      res.json({
        success: true,
        directory: dir,
        createdCount,
        decayedCount
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.post('/api/prune', withContext(async (req, res, ctx) => {
    try {
      const dir = req.body?.directory || (req.query.directory ? String(req.query.directory) : undefined);
      const targetContext = ctx.getContextName();
      const ctxConfig = config.getContext(targetContext);
      const validRoots = dir
        ? [path.resolve(dir)]
        : (ctxConfig?.paths || [process.cwd()]).filter(p => !ConfigManager.isSystemOrHomeRoot(p)).map(p => path.resolve(p));

      if (validRoots.length === 0) {
        res.status(400).json({ error: 'No valid workspace roots found to prune against. Please specify a directory.' });
        return;
      }

      const { prunedCount } = ctx.pruneOrphanCodemaps(validRoots);
      res.json({
        success: true,
        prunedCount
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.get('/api/prompts', (req, res) => {
    res.json({
      prompts: [
        {
          name: 'sd_curate',
          description: 'Holistic memory curation prompt: guided review to consolidate micro-memories, promote generalized rules to _global, and link or prune graph concepts.',
          arguments: [
            {
              name: 'target',
              description: 'Optional target file path or memory ID to focus curation on. Leave empty for a prioritized graph-wide sweep.',
              required: false,
            },
            {
              name: 'threshold',
              description: 'Optional micro-memory threshold for consolidation candidate detection (default: 3).',
              required: false,
            },
            {
              name: 'context',
              description: 'Optional context namespace override (defaults to active workspace context).',
              required: false,
            },
          ],
        },
        {
          name: 'sd_harvest',
          description: 'Discovery harvest prompt: extracts and persists architectural invariants, gotchas, decisions, and patterns discovered during recent work.',
          arguments: [
            {
              name: 'limit',
              description: 'Optional maximum number of recent commits and files to inspect (default: 5).',
              required: false,
            },
            {
              name: 'context',
              description: 'Optional context namespace override (defaults to active workspace context).',
              required: false,
            },
          ],
        },
      ]
    });
  });

  app.post('/api/prompts/curate', withContext(async (req, res, ctx) => {
    try {
      const threshold = req.body?.threshold ? parseInt(String(req.body.threshold), 10) : 3;
      const target = req.body?.target ? String(req.body.target).trim() : undefined;
      const maxCandidates = req.body?.maxCandidates ? parseInt(String(req.body.maxCandidates), 10) : undefined;

      const curateResult = await generateCuratePrompt(ctx, {
        target: target || undefined,
        threshold: isNaN(threshold) ? 3 : threshold,
        maxCandidates
      });

      res.json({
        description: curateResult.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: curateResult.promptText,
            },
          },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.post('/api/prompts/harvest', withContext(async (req, res, ctx) => {
    try {
      const limit = req.body?.limit ? parseInt(String(req.body.limit), 10) : 5;
      const workspaceDir = req.body?.workspaceDir ? String(req.body.workspaceDir) : undefined;
      const gitDiff = req.body?.gitDiff ? String(req.body.gitDiff) : undefined;

      const harvestResult = await generateHarvestPrompt(ctx, {
        limit: isNaN(limit) ? 5 : limit,
        workspaceDir: workspaceDir || process.cwd(),
      });

      let promptText = harvestResult.promptText;
      if (gitDiff && gitDiff.trim()) {
        promptText += `\n\n### 📝 Client Working Copy Diff (Uncommitted Changes)\n\`\`\`diff\n${gitDiff.trim().substring(0, 10000)}\n\`\`\``;
      }

      res.json({
        description: harvestResult.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: promptText,
            },
          },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

function computeNodeModules(nodes: any[], links: any[]): void {
  const fileToModuleMap = new Map<string, string>();
  for (const n of nodes) {
    if (n.type === 'codemap' || n.id?.startsWith('file_')) {
      const path = n.title || '';
      const segments = path.split('/');
      let mod = '_root';
      if (segments.length >= 3) mod = segments.slice(0, 2).join('/');
      else if (segments.length >= 2) mod = segments[0];
      n.module = mod;
      fileToModuleMap.set(n.id, mod);
    }
  }

  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const l of links) {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    if (!adj.has(src)) adj.set(src, new Set());
    if (!adj.has(tgt)) adj.set(tgt, new Set());
    adj.get(src)!.add(tgt);
    adj.get(tgt)!.add(src);
  }

  for (const n of nodes) {
    if (n.module) continue;
    let targetModule = '';
    const visited = new Set<string>([n.id]);
    const queue = [n.id];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      if (fileToModuleMap.has(currId)) {
        targetModule = fileToModuleMap.get(currId)!;
        break;
      }
      const neighbors = adj.get(currId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
    n.module = targetModule || (n.context === '_global' ? '_global' : '_memories');
  }
}

  app.get('/api/graph', withContext(async (req, res, ctx) => {
    const memoriesRow = ctx.getDb().prepare(`
      SELECT COUNT(*) as count, COALESCE(MAX(updated), '') as max_updated FROM memories
    `).get() as { count: number; max_updated: string };

    const relationsRow = ctx.getDb().prepare(`
      SELECT COUNT(*) as count FROM relations
    `).get() as { count: number };

    const memoriesSig = `${memoriesRow?.count || 0}:${memoriesRow?.max_updated || ''}`;
    const relationsSig = `${relationsRow?.count || 0}`;

    const versionHash = crypto.createHash('sha256')
      .update(`${memoriesSig}||${relationsSig}`)
      .digest('hex');

    const clientETag = req.headers['if-none-match'];
    if (clientETag && (clientETag === `"${versionHash}"` || clientETag === `W/"${versionHash}"` || clientETag === versionHash)) {
      res.status(304).end();
      return;
    }

    res.setHeader('ETag', `"${versionHash}"`);

    const memories = ctx.getDb().prepare(`SELECT id, title, type, confidence, created, updated, superseded_by FROM memories`).all();
    const relations = ctx.getDb().prepare(`SELECT source_id AS source, target_id AS target, type FROM relations`).all();
    computeNodeModules(memories, relations);
    res.json({ nodes: memories, links: relations });
  }));

  // Serve static files if they exist (for production build)
  const getProjectRoot = (): string => {
    let curr = __dirname;
    while (curr && curr !== path.parse(curr).root) {
      if (fs.existsSync(path.join(curr, 'package.json')) && fs.existsSync(path.join(curr, 'ui/dist'))) {
        return curr;
      }
      curr = path.dirname(curr);
    }
    return process.cwd();
  };

  const publicDir = path.resolve(getProjectRoot(), 'ui/dist');
  app.use(express.static(publicDir));

  // Fallback for SPA routing
  app.use((req, res) => {
    // Never send HTML fallback for API endpoints or non-GET requests
    if (req.path.startsWith('/api') || req.method !== 'GET') {
      res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
      return;
    }
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send(`UI dist files not found at ${publicDir}`);
    }
  });


  const server = app.listen(port, host, () => {
    console.log(`StormDrain Web UI running on http://${host}:${port}`);
  });

  // Graceful shutdown
  const closeAll = async () => {
    process.removeListener('SIGINT', closeAll);
    process.removeListener('SIGTERM', closeAll);
    for (const ctx of contextCache.values()) {
      await ctx.close();
    }
    contextCache.clear();
    if (server.listening) {
      server.close();
    }
  };

  server.on('close', () => {
    process.removeListener('SIGINT', closeAll);
    process.removeListener('SIGTERM', closeAll);
  });

  process.on('SIGINT', closeAll);
  process.on('SIGTERM', closeAll);

  return server;
};
