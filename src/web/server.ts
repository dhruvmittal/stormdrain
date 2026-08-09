import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
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
    const { type, title, content, tags } = req.body;
    if (!type || !title || !content) {
      res.status(400).json({ error: 'Missing required fields: type, title, and content are required' });
      return;
    }
    try {
      const id = ctx.addMemory(type, title, content, tags || []);
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

  app.put('/api/memories/:id', withContext(async (req, res, ctx) => {
    const id = req.params.id ? String(req.params.id) : '';
    const { title, content, tags, type } = req.body;
    try {
      ctx.updateMemory(id, content, title, tags, type);
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

  app.get('/api/graph', withContext(async (req, res, ctx) => {
    const memories = ctx.getDb().prepare(`SELECT id, title, type, confidence FROM memories`).all();
    const relations = ctx.getDb().prepare(`SELECT source_id AS source, target_id AS target, type FROM relations`).all();
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
