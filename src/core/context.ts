import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { ConfigManager } from './config';
import { initDb } from '../db/schema';
import { syncMemoryToDb, deleteMemoryFromDb } from '../db/sync';
import { parseMemory, serializeMemory, createMemoryMetadata } from './memory';
import { GitManager } from './git';
import { Memory, MemoryType } from '../types';
import { getContextDbPath, getContextMemoriesPath, ensureDirectories } from '../utils/paths';
import { generateWorkspaceFileVertices, makeFileVertexId } from '../utils/fileGraphScanner';

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

  public addMemory(
    type: MemoryType,
    title: string,
    content: string,
    tags: string[] = [],
    source: Memory['metadata']['source'] = 'manual',
    customId?: string,
    targetFile?: string,
    relationType = 'affects'
  ): string {
    const id = customId || `mem_${crypto.randomBytes(6).toString('hex')}`;
    const relations: Array<{ target: string; type: string }> = [];

    if (targetFile) {
      const targetVertexId = makeFileVertexId(targetFile);
      relations.push({ target: targetVertexId, type: relationType });
    }

    const memory: Memory = {
      metadata: createMemoryMetadata(id, type, title, this.name, tags, relations, source),
      content
    };

    this.saveMemory(memory, `[stormdrain] add: ${type} "${title}"`);
    return id;
  }

  public updateMemory(id: string, content?: string, title?: string, tags?: string[], type?: MemoryType) {
    const memory = this.getMemory(id);
    if (!memory) throw new Error(`Memory ${id} not found.`);

    if (content !== undefined) memory.content = content;
    if (title !== undefined) memory.metadata.title = title;
    if (tags !== undefined) memory.metadata.tags = tags;
    if (type !== undefined) memory.metadata.type = type;
    
    memory.metadata.updated = new Date().toISOString();

    this.saveMemory(memory, `[stormdrain] update: ${memory.metadata.type} "${memory.metadata.title}"`);
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

  public syncFileGraph(workspaceDir: string): number {
    const vertices = generateWorkspaceFileVertices(workspaceDir);
    let createdCount = 0;

    for (const v of vertices) {
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

    return createdCount;
  }

  public recallGraph(fileOrMemoryId: string, maxDepth = 2) {
    let startNodeId = fileOrMemoryId;
    if (fileOrMemoryId.includes('/') || fileOrMemoryId.includes('.')) {
      startNodeId = makeFileVertexId(fileOrMemoryId);
    }

    try {
      const stmt = this.db.prepare(`
        WITH RECURSIVE graph_nodes(node_id, depth) AS (
          SELECT ? AS node_id, 0 AS depth
          UNION
          SELECT 
            CASE WHEN r.source_id = g.node_id THEN r.target_id ELSE r.source_id END AS node_id,
            g.depth + 1
          FROM relations r
          JOIN graph_nodes g ON (r.source_id = g.node_id OR r.target_id = g.node_id)
          WHERE g.depth < ?
        )
        SELECT DISTINCT m.*, fts.content as content_snippet, g.depth
        FROM graph_nodes g
        JOIN memories m ON m.id = g.node_id
        LEFT JOIN memories_fts fts ON fts.id = m.id
        ORDER BY g.depth ASC, m.confidence DESC;
      `);

      return stmt.all(startNodeId, maxDepth);
    } catch {
      return [];
    }
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
