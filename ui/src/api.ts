const API_BASE = 'http://localhost:3456/api';

export const api = {
  async getContexts() {
    try {
      const res = await fetch(`${API_BASE}/contexts`);
      return await res.json();
    } catch {
      return null;
    }
  },

  async setContext(name: string) {
    try {
      await fetch(`${API_BASE}/contexts/use`, {
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
      const res = await fetch(`${API_BASE}/memories?context=${context}${qParam}`);
      return await res.json();
    } catch {
      return [];
    }
  },

  async getGraph(context: string) {
    try {
      const res = await fetch(`${API_BASE}/graph?context=${context}`);
      return await res.json();
    } catch {
      return { nodes: [], links: [] };
    }
  },

  async getMemory(context: string, id: string) {
    try {
      const res = await fetch(`${API_BASE}/memories/${id}?context=${context}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async createMemory(context: string, data: { type: string; title: string; content: string; tags?: string[] }) {
    try {
      const res = await fetch(`${API_BASE}/memories?context=${context}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.error(e);
      return { error: 'Failed to create memory' };
    }
  },

  async updateMemory(context: string, id: string, data: { title?: string; content?: string; tags?: string[]; type?: string }) {
    try {
      const res = await fetch(`${API_BASE}/memories/${id}?context=${context}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.error(e);
      return { error: 'Failed to update' };
    }
  },

  async deleteMemory(context: string, id: string) {
    try {
      const res = await fetch(`${API_BASE}/memories/${id}?context=${context}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      console.error(e);
      return { error: 'Failed to delete' };
    }
  }
};
