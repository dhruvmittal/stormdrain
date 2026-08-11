import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { ContextManager } from './context';
import { ConfigManager } from './config';
import { StormDrainMcpServer } from '../mcp';
import { startWebServer } from '../web/server';

describe('Multi-Target & Memory-to-Memory Graph Relations', () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-multirel-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-multirel-home-'));
    process.env.HOME = homeDir;
    process.env.STORMDRAIN_HOME = path.join(homeDir, '.stormdrain');
    process.env.STORMDRAIN_TEST_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.STORMDRAIN_TEST_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  describe('ContextManager Multi-Target & Relation Operations', () => {
    it('should create memory linked to multiple file targets', async () => {
      const ctx = new ContextManager('multi-target-ctx');
      try {
        const id = ctx.addMemory(
          'fact',
          'Cross-Cutting Logging Pattern',
          'Structured logging is used across frontend and backend services.',
          ['logging', 'architecture'],
          'manual',
          undefined,
          ['src/server.ts', 'src/client.ts']
        );

        const memory = ctx.getMemory(id);
        expect(memory).not.toBeNull();
        expect(memory?.metadata.relations.length).toBe(2);
        expect(memory?.metadata.relations).toEqual([
          { target: 'file_src_server_ts', type: 'affects' },
          { target: 'file_src_client_ts', type: 'affects' }
        ]);

        const relations = ctx.getRelations(id);
        expect(relations.outgoing.length).toBe(2);
      } finally {
        await ctx.close();
      }
    });

    it('should support explicit typed relations to files and other memories', async () => {
      const ctx = new ContextManager('typed-rel-ctx');
      try {
        // Create base architectural concept
        const baseId = ctx.addMemory(
          'pattern',
          'Event Sourcing Architecture',
          'All domain state changes are recorded as append-only event streams.',
          ['architecture', 'events']
        );

        // Create secondary memory linking to base concept and files
        const memId = ctx.addMemory(
          'fact',
          'CQRS Read Model Projections',
          'Read models are projected asynchronously from the event stream.',
          ['cqrs', 'read-model'],
          'manual',
          undefined,
          'src/projections.ts',
          'affects',
          [
            { target: baseId, type: 'depends_on' },
            { target: 'src/events.ts', type: 'references' }
          ]
        );

        const memory = ctx.getMemory(memId);
        expect(memory?.metadata.relations).toEqual([
          { target: baseId, type: 'depends_on' },
          { target: 'file_src_events_ts', type: 'references' },
          { target: 'file_src_projections_ts', type: 'affects' }
        ]);

        // Check incoming relations on baseId
        const baseRelations = ctx.getRelations(baseId);
        expect(baseRelations.incoming).toEqual([
          { source: memId, type: 'depends_on' }
        ]);
      } finally {
        await ctx.close();
      }
    });

    it('should support addRelation and removeRelation helpers', async () => {
      const ctx = new ContextManager('relation-helpers-ctx');
      try {
        const memA = ctx.addMemory('fact', 'Memory A', 'Content A');
        const memB = ctx.addMemory('lesson', 'Memory B', 'Content B');

        // Add relation
        const added1 = ctx.addRelation(memA, memB, 'supports');
        expect(added1).toBe(true);

        // Idempotent: duplicate returns false
        const addedAgain = ctx.addRelation(memA, memB, 'supports');
        expect(addedAgain).toBe(false);

        // Verify in DB and memory
        const relsA = ctx.getRelations(memA);
        expect(relsA.outgoing).toEqual([{ target: memB, type: 'supports' }]);

        const relsB = ctx.getRelations(memB);
        expect(relsB.incoming).toEqual([{ source: memA, type: 'supports' }]);

        // Add file relation
        ctx.addRelation(memA, 'src/main.ts', 'applies_to');
        expect(ctx.getMemory(memA)?.metadata.relations.length).toBe(2);

        // Remove relation
        const removed = ctx.removeRelation(memA, memB, 'supports');
        expect(removed).toBe(true);
        expect(ctx.getMemory(memA)?.metadata.relations.length).toBe(1);

        const removeNonExistent = ctx.removeRelation(memA, memB, 'supports');
        expect(removeNonExistent).toBe(false);
      } finally {
        await ctx.close();
      }
    });

    it('should support granular relation updates in updateMemory', async () => {
      const ctx = new ContextManager('update-rel-ctx');
      try {
        const id1 = ctx.addMemory('fact', 'Mem 1', 'Content 1', [], 'manual', undefined, 'src/a.ts');
        const id2 = ctx.addMemory('pattern', 'Mem 2', 'Content 2');

        // Update adding targets and relations
        ctx.updateMemory(id1, undefined, undefined, undefined, undefined, {
          addTargets: ['src/b.ts', id2],
          addRelations: [{ target: 'src/c.ts', type: 'references' }]
        });

        let mem1 = ctx.getMemory(id1);
        expect(mem1?.metadata.relations.map(r => r.target)).toContain('file_src_a_ts');
        expect(mem1?.metadata.relations.map(r => r.target)).toContain('file_src_b_ts');
        expect(mem1?.metadata.relations.map(r => r.target)).toContain(id2);
        expect(mem1?.metadata.relations.map(r => r.target)).toContain('file_src_c_ts');

        // Remove targets and relations
        ctx.updateMemory(id1, undefined, undefined, undefined, undefined, {
          removeTargets: ['src/a.ts', id2],
          removeRelations: [{ target: 'src/c.ts', type: 'references' }]
        });

        mem1 = ctx.getMemory(id1);
        expect(mem1?.metadata.relations).toEqual([
          { target: 'file_src_b_ts', type: 'affects' }
        ]);

        // Full replacement of relations
        ctx.updateMemory(id1, undefined, undefined, undefined, undefined, {
          relations: [{ target: id2, type: 'contradicts' }]
        });

        mem1 = ctx.getMemory(id1);
        expect(mem1?.metadata.relations).toEqual([
          { target: id2, type: 'contradicts' }
        ]);
      } finally {
        await ctx.close();
      }
    });

    it('should traverse memory-to-memory conceptual links during multi-hop recall', async () => {
      const ctx = new ContextManager('concept-recall-ctx');
      try {
        // Setup file DAG
        const srcA = path.join(tempDir, 'controller.ts');
        const srcB = path.join(tempDir, 'service.ts');
        fs.writeFileSync(srcA, 'import { Service } from "./service";');
        fs.writeFileSync(srcB, 'export class Service {}');
        ctx.syncFileGraph(tempDir);

        // Add file-attached invariant
        const fileMemId = ctx.addMemory(
          'warning',
          'Service Connection Throttling',
          'Throttle requests to prevent DB overload.',
          ['throttling'],
          'manual',
          undefined,
          'service.ts'
        );

        // Add conceptual pattern linked to the file invariant
        const conceptMemId = ctx.addMemory(
          'pattern',
          'Token Bucket Algorithm',
          'Use token buckets for rate limiting distributed calls.',
          ['rate-limit', 'algorithms'],
          'manual',
          undefined,
          undefined,
          undefined,
          [{ target: fileMemId, type: 'supports' }]
        );

        // Recall for controller.ts (which imports service.ts)
        const response = ctx.recallMultiHop('controller.ts');
        const downstreamTitles = response.downstream.map(m => m.title);
        
        expect(downstreamTitles).toContain('Service Connection Throttling');
        expect(downstreamTitles).toContain('Token Bucket Algorithm');

        // Also test direct recall on the memory ID itself
        const memRecall = ctx.recallMultiHop(conceptMemId);
        expect(memRecall.all.some(m => m.id === conceptMemId)).toBe(true);
        expect(memRecall.all.some(m => m.id === fileMemId)).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });

  describe('MCP Protocol Multi-Target & Relation Tools', () => {
    it('should support sd_add with targets/relations and sd_relate tool', async () => {
      const config = new ConfigManager();
      config.addContext('mcp-rel-ctx', [tempDir]);
      config.setActiveContext('mcp-rel-ctx');

      const mcpServer = new StormDrainMcpServer();
      const serverInstance = (mcpServer as any).server;
      const handler = serverInstance._requestHandlers.get('tools/call');

      // 1. sd_add with multi-targets and explicit relations
      const addRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_add',
          arguments: {
            type: 'guide',
            title: 'API Versioning Protocol',
            content: 'Always provide backward-compatible v1 and v2 payloads.',
            targets: ['src/api/v1.ts', 'src/api/v2.ts'],
            relations: [{ target: 'src/routes.ts', type: 'applies_to' }],
            context: 'mcp-rel-ctx'
          }
        }
      });
      expect(addRes.content[0].text).toContain('Successfully added memory');
      expect(addRes.content[0].text).toContain('target(s)');

      const matchId = addRes.content[0].text.match(/mem_[a-f0-9]+/);
      const mem1 = matchId ? matchId[0] : '';

      // 2. Add second memory
      const addRes2 = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_add',
          arguments: {
            type: 'fact',
            title: 'Deprecation Header Format',
            content: 'Use Sunset header format per RFC 8594.',
            context: 'mcp-rel-ctx'
          }
        }
      });
      const matchId2 = addRes2.content[0].text.match(/mem_[a-f0-9]+/);
      const mem2 = matchId2 ? matchId2[0] : '';

      // 3. Connect the two memories using sd_relate
      const relateRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_relate',
          arguments: {
            source_id: mem2,
            target: mem1,
            type: 'supports',
            context: 'mcp-rel-ctx'
          }
        }
      });
      expect(relateRes.content[0].text).toContain(`Successfully linked memory ${mem2} -> ${mem1} with relation "supports"`);

      // 4. Update memory with relation changes
      const updateRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_update',
          arguments: {
            id: mem2,
            add_targets: ['src/headers.ts'],
            context: 'mcp-rel-ctx'
          }
        }
      });
      expect(updateRes.content[0].text).toContain(`Successfully updated memory ${mem2}`);
    });
  });

  describe('Web API Server Relation Endpoints', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      server = startWebServer(0);
      await new Promise<void>((resolve) => {
        if (server.listening) resolve();
        else server.once('listening', resolve);
      });
      const addr = server.address() as AddressInfo;
      baseUrl = `http://localhost:${addr.port}`;
    });

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('should support creating memories with targets and managing relations via REST API', async () => {
      // 1. Create memory with targets
      const createRes = await fetch(`${baseUrl}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'lesson',
          title: 'Database Locking Behavior',
          content: 'Row-level locking is preferred over table locking.',
          targets: ['src/db/pool.ts', 'src/db/query.ts']
        })
      });
      expect(createRes.status).toBe(201);
      const { id: memA } = await createRes.json() as any;

      // 2. Create second memory
      const createRes2 = await fetch(`${baseUrl}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pattern',
          title: 'Pessimistic vs Optimistic Locking',
          content: 'Use optimistic locking with version columns.'
        })
      });
      const { id: memB } = await createRes2.json() as any;

      // 3. GET /api/memories/:id/relations
      const getRelsRes = await fetch(`${baseUrl}/api/memories/${memA}/relations`);
      expect(getRelsRes.status).toBe(200);
      const relsA = await getRelsRes.json() as any;
      expect(relsA.outgoing.length).toBe(2);

      // 4. POST /api/relations to connect memB -> memA
      const postRelRes = await fetch(`${baseUrl}/api/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: memB,
          target: memA,
          type: 'supports'
        })
      });
      expect(postRelRes.status).toBe(200);
      const postRelJson = await postRelRes.json() as any;
      expect(postRelJson.success).toBe(true);
      expect(postRelJson.added).toBe(true);

      // 5. DELETE /api/relations
      const delRelRes = await fetch(`${baseUrl}/api/relations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: memB,
          target: memA,
          type: 'supports'
        })
      });
      expect(delRelRes.status).toBe(200);
      const delRelJson = await delRelRes.json() as any;
      expect(delRelJson.removed).toBe(true);
    });
  });
});
