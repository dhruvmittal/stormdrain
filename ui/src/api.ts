const API_BASE = '/api';

const safeJsonFetch = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.substring(0, 120)}`);
  }
  return { ok: res.ok, status: res.status, data: await res.json() };
};

export const api = {
  async getContexts() {
    try {
      const { data } = await safeJsonFetch(`${API_BASE}/contexts`);
      return data;
    } catch {
      return null;
    }
  },

  async setContext(name: string) {
    try {
      await safeJsonFetch(`${API_BASE}/contexts/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch (e) {
      console.error(e);
    }
  },

  async getMemories(context: string, query?: string) {
    try {
      const qParam = query ? `&q=${encodeURIComponent(query)}` : '';
      const { data } = await safeJsonFetch(`${API_BASE}/memories?context=${context}${qParam}`);
      return data;
    } catch {
      return [];
    }
  },

  async getGraphVersion(context: string) {
    try {
      const { data } = await safeJsonFetch(`${API_BASE}/graph/version?context=${context}`);
      return data?.version || '';
    } catch {
      return '';
    }
  },

  async getGraph(context: string) {
    try {
      const { data } = await safeJsonFetch(`${API_BASE}/graph?context=${context}`);
      return data;
    } catch {
      return { nodes: [], links: [] };
    }
  },

  async getMemory(context: string, id: string) {
    try {
      const { ok, data } = await safeJsonFetch(`${API_BASE}/memories/${id}?context=${context}`);
      if (!ok) return null;
      return data;
    } catch {
      return null;
    }
  },

  async createMemory(context: string, data: { type: string; title: string; content: string; tags?: string[] }) {
    try {
      const res = await safeJsonFetch(`${API_BASE}/memories?context=${context}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.data;
    } catch (e: any) {
      console.error(e);
      return { error: e.message || 'Failed to create memory' };
    }
  },

  async updateMemory(context: string, id: string, data: { title?: string; content?: string; tags?: string[]; type?: string }) {
    try {
      const res = await safeJsonFetch(`${API_BASE}/memories/${id}?context=${context}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.data;
    } catch (e: any) {
      console.error(e);
      return { error: e.message || 'Failed to update' };
    }
  },

  async getNodeDetails(context: string, id: string): Promise<FullNodeDetails | null> {
    try {
      const { ok, data } = await safeJsonFetch(`${API_BASE}/nodes/${encodeURIComponent(id)}?context=${encodeURIComponent(context)}`);
      if (!ok) return null;
      return data;
    } catch {
      return null;
    }
  },

  async getConsolidationCandidates(context: string, threshold?: number): Promise<ConsolidationCandidate[]> {
    try {
      const param = threshold ? `&threshold=${threshold}` : '';
      const { data } = await safeJsonFetch(`${API_BASE}/consolidation-candidates?context=${encodeURIComponent(context)}${param}`);
      return data || [];
    } catch {
      return [];
    }
  },

  async consolidate(context: string, targetFile: string, memoryIds?: string[]): Promise<{ consolidatedId: string; mergedCount: number }> {
    try {
      const res = await safeJsonFetch(`${API_BASE}/consolidate?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFile, memoryIds })
      });
      return res.data;
    } catch (e: any) {
      console.error(e);
      return { consolidatedId: '', mergedCount: 0 };
    }
  },

  async deleteMemory(context: string, id: string) {
    try {
      const res = await safeJsonFetch(`${API_BASE}/memories/${id}?context=${context}`, {
        method: 'DELETE'
      });
      return res.data;
    } catch (e: any) {
      console.error(e);
      return { error: e.message || 'Failed to delete' };
    }
  },

  async getConfig(): Promise<StormDrainSettings | null> {
    try {
      const { ok, data } = await safeJsonFetch(`${API_BASE}/config`);
      if (!ok) return null;
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async updateConfig(settings: Partial<StormDrainSettings>): Promise<{ success: boolean; settings?: StormDrainSettings; error?: string }> {
    try {
      const { ok, data } = await safeJsonFetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!ok) {
        return { success: false, error: data.error || 'Failed to update configuration' };
      }
      return data;
    } catch (e: any) {
      console.error(e);
      return { success: false, error: e.message || 'Failed to update configuration' };
    }
  },

  async resetConfig(): Promise<{ success: boolean; settings?: StormDrainSettings; error?: string }> {
    try {
      const { ok, data } = await safeJsonFetch(`${API_BASE}/config/reset`, {
        method: 'POST'
      });
      if (!ok) {
        return { success: false, error: data.error || 'Failed to reset configuration' };
      }
      return data;
    } catch (e: any) {
      console.error(e);
      return { success: false, error: e.message || 'Failed to reset configuration' };
    }
  }
};


export interface ReadToolSettings {
  enabled: boolean;
  mode: 'auto' | 'tokensave' | 'standalone' | 'disabled';
  cachePolicy: 'first_read_only' | 'always' | 'on_file_changed';
  tokenBudget: number;
  maxHops: number;
  includeSymbols: boolean;
  highlightAsPrimary: boolean;
}

export interface GraphColorSettings {
  nodes: {
    concept: string;
    pattern: string;
    guide: string;
    lesson: string;
    warning: string;
    fact: string;
    codemap: string;
    sequence: string;
    [key: string]: string;
  };
  edges: {
    affects: string;
    applies_to: string;
    supports: string;
    contradicts: string;
    supersedes: string;
    related_to: string;
    references: string;
    depends_on: string;
    part_of: string;
    distilled_from: string;
    imports?: string;
    defaultEdge?: string;
    [key: string]: string | undefined;
  };
}

export function applyThemeColors(colors?: GraphColorSettings) {
  if (!colors || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (colors.nodes) {
    for (const [key, val] of Object.entries(colors.nodes)) {
      if (val) {
        root.style.setProperty(`--color-${key}`, val);
      }
    }
  }
  if (colors.edges) {
    for (const [key, val] of Object.entries(colors.edges)) {
      if (val) {
        root.style.setProperty(`--color-edge-${key}`, val);
      }
    }
  }
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
  colors?: GraphColorSettings;
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
  colors?: GraphColorSettings;
}

export interface FullNodeDetails {
  id: string;
  nodeType: 'memory' | 'codemap';
  type: string;
  title: string;
  context: string;
  filePath?: string;
  content: string;
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
  attachedMemories?: Array<{ id: string; type: string; title: string; confidence: number }>;
}

export interface ConsolidationCandidate {
  target: string;
  targetType: 'file' | 'concept';
  targetTitle: string;
  memoryCount: number;
  memories: Array<{
    id: string;
    type: string;
    title: string;
    confidence: number;
    tags: string[];
    summarySnippet: string;
  }>;
}

