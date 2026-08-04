import React, { useEffect, useState } from 'react';
import { api } from '../api';

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

  useEffect(() => {
    if (isNew) {
      setTitle('');
      setType('fact');
      setContent('');
      setTags('');
      setLoading(false);
      return;
    }

    const fetchMemory = async () => {
      setLoading(true);
      const data = await api.getMemory(activeContext, memoryId);
      if (data) {
        setTitle(data.metadata.title);
        setType(data.metadata.type);
        setContent(data.content);
        setTags(data.metadata.tags?.join(', ') || '');
      }
      setLoading(false);
    };
    fetchMemory();
  }, [activeContext, memoryId, isNew]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
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
    if (isNew || !window.confirm('Are you sure you want to delete this memory?')) return;
    setSaving(true);
    await api.deleteMemory(activeContext, memoryId);
    setSaving(false);
    onSave();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isNew ? 'Create New Memory' : 'Edit Memory'}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
        ) : (
          <div className="modal-body">
            <label>Title</label>
            <input 
              type="text" 
              placeholder="Memory title..."
              value={title} 
              onChange={e => setTitle(e.target.value)} 
            />

            <label>Type</label>
            <select 
              value={type} 
              onChange={e => setType(e.target.value)} 
              style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-main)', padding: '10px', borderRadius: '6px', width: '100%', marginBottom: '15px' }}
            >
              <option value="fact">Fact</option>
              <option value="lesson">Lesson</option>
              <option value="pattern">Pattern</option>
              <option value="warning">Warning</option>
              <option value="guide">Guide</option>
              <option value="codemap">Codemap</option>
              <option value="sequence">Sequence</option>
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
            {!isNew && (
              <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={handleDelete} disabled={saving}>
                Delete
              </button>
            )}
          </div>
          <div>
            <button className="btn-secondary" onClick={onClose} style={{ marginRight: 8 }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
              {saving ? 'Saving...' : isNew ? 'Create Memory' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemoryEditor;
