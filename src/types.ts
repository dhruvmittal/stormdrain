export type MemoryType = 'fact' | 'pattern' | 'lesson' | 'warning' | 'guide' | 'codemap' | 'sequence';

export interface MemoryRelation {
  target: string; // id of the target memory
  type: 'supports' | 'contradicts' | 'supersedes' | 'related_to' | 'references' | 'depends_on' | 'distilled_from' | 'part_of';
}

export interface MemoryMetadata {
  id: string;
  type: MemoryType;
  title: string;
  context: string;
  tags: string[];
  confidence: number;
  created: string; // ISO format
  updated: string; // ISO format
  accessed: string; // ISO format
  access_count: number;
  source: 'conversation' | 'indexer' | 'manual' | 'promotion';
  expires: string | null; // ISO format
  superseded_by: string | null; // id of superseding memory
  relations: MemoryRelation[];
}

export interface Memory {
  metadata: MemoryMetadata;
  content: string; // The markdown content excluding frontmatter
}

export interface ContextConfig {
  name: string;
  paths: string[];
  parent: string | null;
}

export interface GlobalConfig {
  contexts: Record<string, ContextConfig>;
  activeContext: string; // The currently active context
}

export interface MultiHopMemoryResult {
  id: string;
  type: MemoryType;
  title: string;
  confidence: number;
  depth: number;
  direction: 'direct' | 'upstream_caller' | 'downstream_dependency';
  relevanceScore: number;
  targetFile?: string;
  tags: string[];
  content_snippet?: string;
}

export interface MultiHopRecallResponse {
  direct: MultiHopMemoryResult[];
  upstream: MultiHopMemoryResult[];
  downstream: MultiHopMemoryResult[];
  all: MultiHopMemoryResult[];
}

export interface ReadToolSettings {
  enabled: boolean;
  mode: 'auto' | 'tokensave' | 'standalone' | 'disabled';
  cachePolicy: 'first_read_only' | 'always' | 'on_file_changed';
  tokenBudget: number;
  maxHops: number;
  includeSymbols: boolean;
}

export interface GraphSettings {
  forwardWeight: number;
  reverseWeight: number;
  cumulativeMassThreshold: number;
  pushThreshold: number;
  consolidationThreshold: number;
}

export interface DecaySettings {
  decayRate: number;
  minFloor: number;
}

export interface GitSettings {
  enabled: boolean;
  debounceMs: number;
}

export interface StormDrainSettings {
  readTool: ReadToolSettings;
  graph: GraphSettings;
  decay: DecaySettings;
  git: GitSettings;
}

export interface GlobalConfig {
  contexts: Record<string, ContextConfig>;
  activeContext: string; // The currently active context
  settings?: StormDrainSettings;
}

