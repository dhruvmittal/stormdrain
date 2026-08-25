import { Memory, MemoryType, FullNodeDetails, ConsolidationCandidate } from '../types';

export type ViewTab = 'overview' | 'tree' | 'matrix' | 'relational' | 'curate';

export interface ContextMetrics {
  contextName: string;
  totalMemories: number;
  codemapVertices: number;
  consolidationCandidatesCount: number;
  decayedMemoriesCount: number;
  avgConfidence: number;
  boundPaths: string[];
}

export interface TreeFileNode {
  id: string;
  relativePath: string;
  imports: string[];
  attachedMemories: Array<{
    id: string;
    type: MemoryType;
    title: string;
    confidence: number;
  }>;
  astOutline?: string[];
}

export interface TreeFolderNode {
  name: string;
  path: string;
  files: TreeFileNode[];
  subfolders: Record<string, TreeFolderNode>;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'decay' | 'sync' | 'mcp';
  message: string;
}

export interface TuiOptions {
  context?: string;
  snapshot?: boolean;
  intervalMs?: number;
}
