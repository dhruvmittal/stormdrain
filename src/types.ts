export const USER_CREATABLE_TYPES = ['fact', 'decision', 'guide', 'warning', 'concept'] as const;
export const CANONICAL_MEMORY_TYPES = [...USER_CREATABLE_TYPES, 'codemap'] as const;

export type CanonicalMemoryType = typeof CANONICAL_MEMORY_TYPES[number];
export type UserCreatableMemoryType = typeof USER_CREATABLE_TYPES[number];
export type LegacyMemoryType = 'invariant' | 'pattern' | 'lesson' | 'sequence' | 'learning';

export type MemoryType = CanonicalMemoryType | LegacyMemoryType;

export const LEGACY_TYPE_MAP: Record<string, CanonicalMemoryType> = {
  invariant: 'fact',
  lesson: 'warning',
  learning: 'warning',
  pattern: 'concept',
  sequence: 'guide',
};

export function toCanonicalType(type: string): CanonicalMemoryType {
  const lower = (type || '').toLowerCase();
  if (LEGACY_TYPE_MAP[lower]) return LEGACY_TYPE_MAP[lower];
  if ((CANONICAL_MEMORY_TYPES as readonly string[]).includes(lower)) return lower as CanonicalMemoryType;
  return 'fact';
}

export type RelationType = 
  | 'affects' 
  | 'applies_to' 
  | 'supports' 
  | 'contradicts' 
  | 'supersedes' 
  | 'related_to' 
  | 'references' 
  | 'depends_on' 
  | 'distilled_from' 
  | 'part_of' 
  | 'imports';

export interface MemoryRelation {
  target: string; // id of the target memory or file vertex
  type: RelationType;
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
  source: string;
  expires: string | null; // ISO format
  superseded_by: string | null; // id of superseding memory
  relations: MemoryRelation[];
  git_branch?: string | null;
  is_canonical?: boolean;
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
  git_branch?: string | null;
  is_canonical?: boolean;
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
  highlightAsPrimary: boolean;
}


export interface GraphSettings {
  forwardWeight: number;
  reverseWeight: number;
  cumulativeMassThreshold: number;
  pushThreshold: number;
  consolidationThreshold: number;
  performanceThreshold: number;
  repulsionDistanceMax: number;
  repulsionTheta: number;
  labelMode?: 'all' | 'dynamic' | 'hover-only';
  labelFilter?: 'all' | 'always-show-memories';
  labelTextBacking?: boolean;
  labelFocusMode?: boolean;
  highlightNewest?: boolean;
  highlightTimeout?: number;
  attenuateInterModule?: boolean;
  freezeOutOfScopeNodes?: boolean;
  interModuleTensionRatio?: number;
  memoryChargeStrength?: number;
}

export interface DecaySettings {
  decayRate: number;
  minFloor: number;
}

export interface GitSettings {
  enabled: boolean;
  debounceMs: number;
}

export interface GraphNodeColors {
  fact: string;
  decision: string;
  warning: string;
  concept: string;
  guide: string;
  codemap: string;
  [key: string]: string;
}

export interface GraphEdgeColors {
  imports: string;
  affects: string;
  applies_to: string;
  supports: string;
  contradicts: string;
  supersedes: string;
  depends_on: string;
  references: string;
  related_to: string;
  part_of: string;
  distilled_from: string;
  defaultEdge: string;
  [key: string]: string;
}

export interface GraphColorSettings {
  nodes: GraphNodeColors;
  edges: GraphEdgeColors;
  highlight?: string;
}

export interface StormDrainSettings {
  readTool: ReadToolSettings;
  graph: GraphSettings;
  decay: DecaySettings;
  git: GitSettings;
  colors?: GraphColorSettings;
}

export interface GlobalConfig {
  contexts: Record<string, ContextConfig>;
  activeContext: string; // The currently active context
  settings?: StormDrainSettings;
}

export interface FullNodeDetails {
  id: string;
  nodeType: 'memory' | 'codemap';
  type: MemoryType;
  title: string;
  context: string;
  filePath?: string;
  content?: string;
  confidence?: number;
  tags?: string[];
  created?: string;
  updated?: string;
  accessed?: string;
  access_count?: number;
  source?: string;
  expires?: string | null;
  superseded_by?: string | null;
  astOutline?: string[];
  outgoingRelations: Array<{ target: string; type: string; title?: string }>;
  incomingRelations: Array<{ source: string; type: string; title?: string }>;
  attachedMemories?: Array<{ id: string; type: MemoryType; title: string; confidence: number }>;
  git_branch?: string | null;
  is_canonical?: boolean;
}

export interface ConsolidationCandidate {
  target: string;
  targetType: 'file' | 'tag' | 'concept';
  targetTitle: string;
  memoryCount: number;
  memories: Array<{
    id: string;
    type: MemoryType;
    title: string;
    confidence: number;
    tags: string[];
    summarySnippet: string;
  }>;
}

export interface ConsolidationOptions {
  target_file: string;
  memory_ids?: string[];
  context?: string;
}

export * from './db/types';


