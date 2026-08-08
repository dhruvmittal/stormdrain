import React, { useEffect, useState } from 'react';
import { api } from '../api';
import MemoryEditor from './MemoryEditor';
import { Search, Plus } from 'lucide-react';

interface MemoryBrowserProps {
  activeContext: string;
}

const MemoryBrowser: React.FC<MemoryBrowserProps> = ({ activeContext }) => {
  const [memories, setMemories] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchMemories = async (query = searchQuery) => {
    if (!activeContext) return;
    const data = await api.getMemories(activeContext, query);
    setMemories(data);
  };

  useEffect(() => {
    fetchMemories(searchQuery);
  }, [activeContext, searchQuery]);

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Memory Browser</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>View, search, and manage context memories</p>
        </div>
        <button 
          className="btn-primary" 
          onClick={() => setEditingId('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: '6px', background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          <Plus size={16} /> New Memory
        </button>
      </div>

      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px 12px' }}>
        <Search size={18} style={{ color: 'var(--text-muted)', marginRight: 10 }} />
        <input 
          type="text"
          placeholder="Search memories by text, title, or tag..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', width: '100%', outline: 'none', fontSize: '0.95rem' }}
        />
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Confidence</th>
              <th>Last Updated</th>
              <th>Last Accessed</th>
            </tr>
          </thead>
          <tbody>
            {memories.map(m => (
              <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setEditingId(m.id)}>
                <td>
                  <span className={`badge badge-${m.type}`}>{m.type}</span>
                </td>
                <td style={{ fontWeight: 500 }}>{m.title}</td>
                <td>
                  <div style={{ width: '100%', backgroundColor: 'var(--bg-surface-hover)', borderRadius: '4px', height: '6px' }}>
                    <div style={{ width: `${(m.confidence || 1.0) * 100}%`, backgroundColor: 'var(--accent-color)', height: '100%', borderRadius: '4px' }}></div>
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{formatDate(m.updated)}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {m.accessed ? (
                    <div>
                      {formatDate(m.accessed)}
                      {m.access_count > 0 && (
                        <span style={{ marginLeft: 6, fontSize: '0.78rem', color: 'var(--accent-color)', background: 'rgba(59, 130, 246, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                          {m.access_count} {m.access_count === 1 ? 'read' : 'reads'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--border-color)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {memories.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>
                  {searchQuery ? `No memories found matching "${searchQuery}"` : 'No memories found in this context.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId && (
        <MemoryEditor
          activeContext={activeContext}
          memoryId={editingId}
          onClose={() => setEditingId(null)}
          onSave={() => {
            setEditingId(null);
            fetchMemories();
          }}
        />
      )}
    </div>
  );
};

export default MemoryBrowser;
