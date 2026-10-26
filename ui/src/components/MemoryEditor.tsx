import React, { useEffect, useState, useRef } from 'react';
import { api, CREATABLE_MEMORY_TYPES } from '../api';
import { copyToClipboard } from '../utils/clipboard';

interface MemoryEditorProps {
  activeContext: string;
  memoryId: string | 'new';
  onClose: () => void;
  onSave: () => void;
}

const MemoryEditor: React.FC<MemoryEditorProps> = ({ activeContext, memoryId, onClose, onSave }) => {
  const isNew = memoryId === 'new';
  const [title, setTitle] = useState('');
  const [type, setType] = useState('fact');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const initialValuesRef = useRef<{ title: string; type: string; tags: string; content: string } | null>(null);

  useEffect(() => {
    if (isNew) {
      setTitle('');
      setType('fact');
      setContent('');
      setTags('');
      initialValuesRef.current = { title: '', type: 'fact', tags: '', content: '' };
      setLoading(false);
      setNotFound(false);
      return;
    }

    const fetchMemory = async () => {
      setLoading(true);
      setNotFound(false);
      const data = await api.getMemory(activeContext, memoryId);
      if (data) {
        setTitle(data.metadata.title);
        setType(data.metadata.type);
        setContent(data.content);
        const tagStr = data.metadata.tags?.join(', ') || '';
        setTags(tagStr);
        initialValuesRef.current = {
          title: data.metadata.title,
          type: data.metadata.type,
          tags: tagStr,
          content: data.content
        };
      } else {
        setNotFound(true);
      }
      setLoading(false);
    };
    fetchMemory();
  }, [activeContext, memoryId, isNew]);

  const isDirty = () => {
    if (!initialValuesRef.current || notFound) return false;
    return (
      title !== initialValuesRef.current.title ||
      type !== initialValuesRef.current.type ||
      tags !== initialValuesRef.current.tags ||
      content !== initialValuesRef.current.content
    );
  };

  const handleSafeClose = () => {
    if (isDirty() && !window.confirm('Discard unsaved changes?')) {
      return;
    }
    onClose();
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim() || notFound) return;
    setSaving(true);
    const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);

    if (isNew) {
      await api.createMemory(activeContext, { title, content, tags: parsedTags, type });
    } else {
      await api.updateMemory(activeContext, memoryId, { title, content, tags: parsedTags, type });
    }
    setSaving(false);
    onSave();
  };

  const handleDelete = async () => {
    if (isNew || notFound || !window.confirm('Are you sure you want to delete this memory?')) return;
    setSaving(true);
    await api.deleteMemory(activeContext, memoryId);
    setSaving(false);
    onSave();
  };

  // Modal keyboard shortcuts: Esc to close, Cmd/Ctrl + Enter to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleSafeClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (e.isComposing || (e as any).nativeEvent?.isComposing || saving || notFound || !title.trim() || !content.trim()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [title, type, tags, content, saving, notFound]);

  return (
    <div className="modal-overlay" onClick={handleSafeClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3>{isNew ? 'Create New Memory' : 'Edit Memory'}</h3>
            {!isNew && memoryId !== 'new' && (
              <span 
                className="memory-id-badge"
                onClick={async (e) => {
                  e.stopPropagation();
                  await copyToClipboard(memoryId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                title="Click to copy full Memory ID"
              >
                {copied ? 'Copied ID!' : memoryId}
              </span>
            )}
          </div>
          <button className="close-btn" onClick={handleSafeClose}>×</button>
        </div>
        
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
        ) : notFound ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--color-warning)', marginBottom: 8 }}>
              Memory Not Found
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              This memory may have been removed or consolidated by another session.
            </p>
          </div>
        ) : (
          <div className="modal-body">
            <label>Title</label>
            <input 
              type="text" 
              placeholder="Memory title..."
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              autoFocus
            />

            <label>Type</label>
            <select 
              value={type} 
              onChange={e => setType(e.target.value)} 
              style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-main)', padding: '10px', borderRadius: '6px', width: '100%', marginBottom: '15px' }}
            >
              {CREATABLE_MEMORY_TYPES.map(t => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>

            <label>Tags (comma separated)</label>
            <input 
              type="text" 
              placeholder="e.g. backend, database, security"
              value={tags} 
              onChange={e => setTags(e.target.value)} 
            />

            <label>Content (Markdown)</label>
            <textarea 
              rows={10} 
              placeholder="Memory content in Markdown format..."
              value={content} 
              onChange={e => setContent(e.target.value)} 
            />
          </div>
        )}

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {!isNew && !notFound && (
              <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={handleDelete} disabled={saving}>
                Delete
              </button>
            )}
          </div>
          <div>
            <button className="btn-secondary" onClick={handleSafeClose} style={{ marginRight: 8 }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || notFound || !title.trim() || !content.trim()}>
              {saving ? 'Saving...' : isNew ? 'Create Memory' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemoryEditor;
