import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { ContextMetrics, TreeFileNode, TreeFolderNode } from './types';
import { Memory, ConsolidationCandidate, FullNodeDetails } from '../types';

export class TuiDataFetcher {
  private config: ConfigManager;

  constructor(config?: ConfigManager) {
    this.config = config || new ConfigManager();
  }

  public getContextMetrics(contextName: string): ContextMetrics {
    const ctx = new ContextManager(contextName);
    try {
      const db = ctx.getDb();
      const memories = ctx.listMemories();
      const codemapCountRow = db.prepare("SELECT COUNT(*) as count FROM memories WHERE type = 'codemap'").get() as { count: number };
      const decayedRow = db.prepare(`
        SELECT COUNT(DISTINCT m.id) as count 
        FROM memories m 
        LEFT JOIN tags t ON t.memory_id = m.id 
        WHERE m.confidence < 0.75 OR t.tag = 'stale'
      `).get() as { count: number };
      
      const candidates = ctx.findConsolidationCandidates();
      
      let sumConf = 0;
      for (const m of memories) {
        sumConf += m.metadata.confidence;
      }
      const avgConf = memories.length > 0 ? Math.round((sumConf / memories.length) * 100) / 100 : 1.0;

      const ctxConfig = this.config.getContext(contextName);

      return {
        contextName,
        totalMemories: memories.length,
        codemapVertices: codemapCountRow.count,
        consolidationCandidatesCount: candidates.length,
        decayedMemoriesCount: decayedRow.count,
        avgConfidence: avgConf,
        boundPaths: ctxConfig?.paths || []
      };
    } finally {
      ctx.close();
    }
  }

  public getMemories(contextName: string, searchQuery?: string, typeFilter?: string): Memory[] {
    const ctx = new ContextManager(contextName);
    try {
      let memories = ctx.listMemories();

      if (typeFilter && typeFilter !== 'all') {
        memories = memories.filter(m => m.metadata.type === typeFilter);
      }

      if (searchQuery && searchQuery.trim()) {
        const queryLower = searchQuery.toLowerCase().trim();
        memories = memories.filter(m => 
          m.metadata.title.toLowerCase().includes(queryLower) ||
          m.content.toLowerCase().includes(queryLower) ||
          m.metadata.tags.some(t => t.toLowerCase().includes(queryLower)) ||
          m.metadata.id.toLowerCase().includes(queryLower)
        );
      }

      return memories;
    } finally {
      ctx.close();
    }
  }

  public getFileTree(contextName: string): TreeFolderNode {
    const ctx = new ContextManager(contextName);
    try {
      const db = ctx.getDb();
      const codemaps = db.prepare(`
        SELECT id, title FROM memories WHERE type = 'codemap' ORDER BY title ASC
      `).all() as Array<{ id: string; title: string }>;

      const rootFolder: TreeFolderNode = {
        name: 'root',
        path: '',
        files: [],
        subfolders: {}
      };

      for (const cm of codemaps) {
        const relPath = cm.title.replace(/^\[(File|Submodule|Codemap)\]\s*/, '');
        const parts = relPath.split('/');
        const fileName = parts.pop() || relPath;

        let currentFolder = rootFolder;
        let currentPath = '';

        for (const dirPart of parts) {
          currentPath = currentPath ? `${currentPath}/${dirPart}` : dirPart;
          if (!currentFolder.subfolders[dirPart]) {
            currentFolder.subfolders[dirPart] = {
              name: dirPart,
              path: currentPath,
              files: [],
              subfolders: {}
            };
          }
          currentFolder = currentFolder.subfolders[dirPart];
        }

        // Get attached memories for this file
        const attachedRows = db.prepare(`
          SELECT m.id, m.type, m.title, m.confidence
          FROM relations r
          JOIN memories m ON m.id = r.source_id
          WHERE r.target_id = ? AND r.type IN ('affects', 'applies_to')
        `).all(cm.id) as Array<{ id: string; type: any; title: string; confidence: number }>;

        // Extract imports from content using ctx.getMemory
        const imports: string[] = [];
        const fullMem = ctx.getMemory(cm.id);
        const lines = fullMem ? fullMem.content.split('\n') : [];
        for (const l of lines) {
          if (l.startsWith('Imports:')) {
            const impListStr = l.substring('Imports:'.length).trim();
            if (impListStr && impListStr !== 'none') {
              impListStr.split(',').forEach(i => imports.push(i.trim()));
            }
          }
        }


        currentFolder.files.push({
          id: cm.id,
          relativePath: relPath,
          imports,
          attachedMemories: attachedRows
        });
      }

      return rootFolder;
    } finally {
      ctx.close();
    }
  }

  public getCandidates(contextName: string): ConsolidationCandidate[] {
    const ctx = new ContextManager(contextName);
    try {
      return ctx.findConsolidationCandidates();
    } finally {
      ctx.close();
    }
  }

  public getNodeDetails(contextName: string, idOrPath: string): FullNodeDetails | null {
    const ctx = new ContextManager(contextName);
    try {
      return ctx.getNodeDetails(idOrPath);
    } finally {
      ctx.close();
    }
  }
}
