import Database from 'better-sqlite3';
import { Memory } from '../types';

interface DbStatementCache {
  insertMemory: Database.Statement;
  insertTag: Database.Statement;
  deleteTags: Database.Statement;
  insertRelation: Database.Statement;
  deleteRelations: Database.Statement;
  insertFts: Database.Statement;
  deleteFts: Database.Statement;
  deleteMemory: Database.Statement;
  deleteMemoryFts: Database.Statement;
  deleteMemoryTags: Database.Statement;
  deleteMemoryRelations: Database.Statement;
}

const statementCacheMap = new WeakMap<Database.Database, DbStatementCache>();

function getStatementCache(db: Database.Database): DbStatementCache {
  let cache = statementCacheMap.get(db);
  if (!cache) {
    cache = {
      insertMemory: db.prepare(`
        INSERT INTO memories (id, type, title, context, confidence, created, updated, accessed, access_count, source, expires, superseded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type,
          title=excluded.title,
          context=excluded.context,
          confidence=excluded.confidence,
          updated=excluded.updated,
          accessed=excluded.accessed,
          access_count=excluded.access_count,
          source=excluded.source,
          expires=excluded.expires,
          superseded_by=excluded.superseded_by
      `),
      insertTag: db.prepare(`
        INSERT OR IGNORE INTO tags (memory_id, tag) VALUES (?, ?)
      `),
      deleteTags: db.prepare(`
        DELETE FROM tags WHERE memory_id = ?
      `),
      insertRelation: db.prepare(`
        INSERT OR IGNORE INTO relations (source_id, target_id, type) VALUES (?, ?, ?)
      `),
      deleteRelations: db.prepare(`
        DELETE FROM relations WHERE source_id = ?
      `),
      insertFts: db.prepare(`
        INSERT INTO memories_fts (id, title, content) VALUES (?, ?, ?)
      `),
      deleteFts: db.prepare(`
        DELETE FROM memories_fts WHERE id = ?
      `),
      deleteMemory: db.prepare('DELETE FROM memories WHERE id = ?'),
      deleteMemoryFts: db.prepare('DELETE FROM memories_fts WHERE id = ?'),
      deleteMemoryTags: db.prepare('DELETE FROM tags WHERE memory_id = ?'),
      deleteMemoryRelations: db.prepare('DELETE FROM relations WHERE source_id = ? OR target_id = ?')
    };
    statementCacheMap.set(db, cache);
  }
  return cache;
}

export const syncMemoryToDb = (db: Database.Database, memory: Memory) => {
  const m = memory.metadata;
  const cache = getStatementCache(db);

  const tx = db.transaction(() => {
    // 1. Upsert memory metadata
    cache.insertMemory.run(
      m.id,
      m.type,
      m.title,
      m.context,
      m.confidence,
      m.created,
      m.updated,
      m.accessed,
      m.access_count,
      m.source || 'direct',
      m.expires ?? null,
      m.superseded_by ?? null
    );

    // 2. Update tags
    cache.deleteTags.run(m.id);
    for (const tag of m.tags) {
      cache.insertTag.run(m.id, tag);
    }

    // 3. Update relations
    cache.deleteRelations.run(m.id);
    for (const rel of m.relations) {
      cache.insertRelation.run(m.id, rel.target, rel.type);
    }

    // 4. Update FTS
    cache.deleteFts.run(m.id);
    cache.insertFts.run(m.id, m.title, memory.content);
  });

  tx();
};

export const deleteMemoryFromDb = (db: Database.Database, id: string) => {
  const cache = getStatementCache(db);
  const tx = db.transaction(() => {
    cache.deleteMemory.run(id);
    cache.deleteMemoryFts.run(id);
    cache.deleteMemoryTags.run(id);
    cache.deleteMemoryRelations.run(id, id);
  });
  tx();
};
