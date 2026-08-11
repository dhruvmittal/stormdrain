import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api';
import MemoryEditor from './MemoryEditor';
import { Search, Plus, ArrowUp, ArrowDown, ArrowUpDown, X } from 'lucide-react';

interface MemoryBrowserProps {
  activeContext: string;
  dataVersion?: number;
}

type SortField = 'type' | 'title' | 'confidence' | 'updated' | 'accessed';
type SortDirection = 'asc' | 'desc';

const MEMORY_TYPES = ['all', 'concept', 'pattern', 'guide', 'lesson', 'fact', 'warning', 'codemap', 'sequence'] as const;

const MemoryBrowser: React.FC<MemoryBrowserProps> = ({ activeContext, dataVersion = 0 }) => {
  const [memories, setMemories] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchMemories = async (query = searchQuery) => {
    if (!activeContext) return;
    const data = await api.getMemories(activeContext, query);
    setMemories(data);
  };

  useEffect(() => {
    fetchMemories(searchQuery);
  }, [activeContext, searchQuery, dataVersion]);


  // Compute type counts dynamically across current context
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: memories.length };
    for (const m of memories) {
      counts[m.type] = (counts[m.type] || 0) + 1;
    }
    return counts;
  }, [memories]);

  // Filter by selected type and apply client-side sorting
  const processedMemories = useMemo(() => {
    let list = memories;

    // 1. Type Filter
    if (selectedType !== 'all') {
      list = list.filter(m => m.type === selectedType);
    }

    // 2. Sorting
    return [...list].sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (sortField === 'accessed') {
        valA = a.accessed ? new Date(a.accessed).getTime() : 0;
        valB = b.accessed ? new Date(b.accessed).getTime() : 0;
      } else if (sortField === 'updated') {
        valA = a.updated ? new Date(a.updated).getTime() : 0;
        valB = b.updated ? new Date(b.updated).getTime() : 0;
      } else if (sortField === 'confidence') {
        valA = a.confidence ?? 1.0;
        valB = b.confidence ?? 1.0;
      } else if (sortField === 'title' || sortField === 'type') {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [memories, selectedType, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // Sensible defaults: text asc first, dates & numbers desc first
      setSortDirection(field === 'title' || field === 'type' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={14} style={{ opacity: 0.35 }} />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp size={14} style={{ color: 'var(--accent-hover)' }} />
    ) : (
      <ArrowDown size={14} style={{ color: 'var(--accent-hover)' }} />
    );
  };

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
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
            Showing {processedMemories.length} of {memories.length} memories in <strong>{activeContext}</strong>
          </p>
        </div>
        <button 
          className="btn-primary" 
          onClick={() => setEditingId('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: '6px', background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          <Plus size={16} /> New Memory
        </button>
      </div>

      <div style={{ padding: '20px 30px 0 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {/* Segmented Type Filter Pills */}
        <div className="filter-pills-bar" style={{ marginBottom: 0, flex: '1 1 auto' }}>
          {MEMORY_TYPES.map(type => {
            const count = typeCounts[type] || 0;
            const isActive = selectedType === type;
            return (
              <button
                key={type}
                className={`filter-pill ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedType(type)}
                style={{
                  border: isActive ? '1px solid var(--accent-color)' : undefined,
                  textTransform: type === 'all' ? 'capitalize' : 'uppercase'
                }}
              >
                <span>{type}</span>
                <span className="filter-pill-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Compact Inline Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '6px 14px', width: '250px', transition: 'all 0.2s ease' }}>
          <Search size={15} style={{ color: 'var(--text-muted)', marginRight: 8, flexShrink: 0 }} />
          <input 
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', width: '100%', outline: 'none', fontSize: '0.85rem' }}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, marginLeft: 4 }}
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="table-container" style={{ paddingTop: '15px' }}>
        <table>
          <thead>
            <tr>
              <th className={`sortable-th ${sortField === 'type' ? 'sorted' : ''}`} onClick={() => handleSort('type')}>
                <span className="th-content">Type {renderSortIcon('type')}</span>
              </th>
              <th className={`sortable-th ${sortField === 'title' ? 'sorted' : ''}`} onClick={() => handleSort('title')}>
                <span className="th-content">Title {renderSortIcon('title')}</span>
              </th>
              <th className={`sortable-th ${sortField === 'confidence' ? 'sorted' : ''}`} onClick={() => handleSort('confidence')}>
                <span className="th-content">Confidence {renderSortIcon('confidence')}</span>
              </th>
              <th className={`sortable-th ${sortField === 'updated' ? 'sorted' : ''}`} onClick={() => handleSort('updated')}>
                <span className="th-content">Last Updated {renderSortIcon('updated')}</span>
              </th>
              <th className={`sortable-th ${sortField === 'accessed' ? 'sorted' : ''}`} onClick={() => handleSort('accessed')}>
                <span className="th-content">Last Accessed {renderSortIcon('accessed')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {processedMemories.map(m => (
              <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setEditingId(m.id)}>
                <td>
                  <span className={`badge badge-${m.type}`}>{m.type}</span>
                </td>
                <td style={{ fontWeight: 500 }}>{m.title}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: '80px', backgroundColor: 'var(--bg-surface-hover)', borderRadius: '4px', height: '6px' }}>
                      <div style={{ width: `${(m.confidence || 1.0) * 100}%`, backgroundColor: m.confidence < 0.8 ? 'var(--color-warning)' : 'var(--accent-color)', height: '100%', borderRadius: '4px' }}></div>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{Math.round((m.confidence || 1.0) * 100)}%</span>
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
            {processedMemories.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                  <div>No memories match your current filters.</div>
                  {(selectedType !== 'all' || searchQuery) && (
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setSelectedType('all');
                        setSearchQuery('');
                      }}
                      style={{ marginTop: 12, padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Clear Filters
                    </button>
                  )}
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
