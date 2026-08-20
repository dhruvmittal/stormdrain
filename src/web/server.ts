import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';

export const startWebServer = (port: number = 3456) => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const config = new ConfigManager();
  const contextCache = new Map<string, ContextManager>();

  const getContext = (name: string): ContextManager => {
    let ctx = contextCache.get(name);
    if (!ctx) {
      ctx = new ContextManager(name);
      contextCache.set(name, ctx);
    }
    return ctx;
  };

  // Helper middleware wrapper
  const withContext = (handler: (req: express.Request, res: express.Response, ctx: ContextManager) => Promise<void>) => {
    return async (req: express.Request, res: express.Response) => {
      const active = req.query.context ? String(req.query.context) : config.getActiveContext();
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
    try {
      config.setActiveContext(name);
      res.json({ success: true, active: name });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/contexts/:name', (req, res) => {
    const name = req.params.name ? String(req.params.name) : '';
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
    if (query) {
      const results = ctx.searchMemories(query);
      res.json(results);
    } else {
      const memories = ctx.getDb().prepare(`SELECT id, type, title, confidence, created, updated, accessed, access_count, source FROM memories ORDER BY updated DESC`).all();
      res.json(memories);
    }
  }));

  app.post('/api/memories', withContext(async (req, res, ctx) => {
    const { type, title, content, tags, target, targets, targetFile, relationType, relations } = req.body;
    if (!type || !title || !content) {
      res.status(400).json({ error: 'Missing required fields: type, title, and content are required' });
      return;
    }
    try {
      const targetArg = targets || target || targetFile;
      const id = ctx.addMemory(type, title, content, tags || [], 'manual', undefined, targetArg, relationType || 'affects', relations);
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
    const { title, content, tags, type, relations, addRelations, removeRelations, addTargets, removeTargets } = req.body;
    try {
      ctx.updateMemory(id, content, title, tags, type, {
        relations,
        addRelations,
        removeRelations,
        addTargets,
        removeTargets
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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

  app.get('/api/graph/version', withContext(async (req, res, ctx) => {
    const memoriesRow = ctx.getDb().prepare(`
      SELECT COUNT(*) as count, COALESCE(MAX(updated), '') as max_updated FROM memories
    `).get() as { count: number; max_updated: string };

    const relationsRow = ctx.getDb().prepare(`
      SELECT COUNT(*) as count FROM relations
    `).get() as { count: number };

    const memoriesSig = `${memoriesRow?.count || 0}:${memoriesRow?.max_updated || ''}`;
    const relationsSig = `${relationsRow?.count || 0}`;

    const hash = crypto.createHash('sha256')
      .update(`${memoriesSig}||${relationsSig}`)
      .digest('hex');

    res.json({ version: hash });
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


  const server = app.listen(port, () => {
    console.log(`StormDrain Web UI running on http://localhost:${port}`);
  });

  // Graceful shutdown
  const closeAll = async () => {
    for (const ctx of contextCache.values()) {
      await ctx.close();
    }
    contextCache.clear();
    server.close();
  };

  process.on('SIGINT', closeAll);
  process.on('SIGTERM', closeAll);

  return server;
};
