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

