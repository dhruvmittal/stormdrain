import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  GitBranch, 
  RotateCcw, 
  Save, 
  Check, 
  AlertTriangle, 
  Cpu, 
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import { api, type StormDrainSettings } from '../api';


const DEFAULT_SETTINGS: StormDrainSettings = {
  readTool: {
    enabled: true,
    mode: 'auto',
    cachePolicy: 'first_read_only',
    tokenBudget: 500,
    maxHops: 2,
    includeSymbols: true,
    highlightAsPrimary: true
  },
  graph: {
    forwardWeight: 0.80,
    reverseWeight: 0.25,
    cumulativeMassThreshold: 0.85,
    pushThreshold: 0.0001,
    consolidationThreshold: 3
  },
  decay: {
    decayRate: 0.85,
    minFloor: 0.30
  },
  git: {
    enabled: true,
    debounceMs: 1500
  }
};

interface ConfigViewProps {
  dataVersion?: number;
}

export const ConfigView: React.FC<ConfigViewProps> = ({ dataVersion = 0 }) => {
  const [settings, setSettings] = useState<StormDrainSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadSettings();
  }, [dataVersion]);


  const loadSettings = async () => {
    setLoading(true);
    const data = await api.getConfig();
    if (data) {
      setSettings(data);
    }
    setLoading(false);
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await api.updateConfig(settings);
    setSaving(false);
    if (res.success && res.settings) {
      setSettings(res.settings);
      showToast('Settings saved and applied successfully!');
    } else {
      showToast(res.error || 'Failed to save settings', 'error');
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all configuration options to their default values?')) {
      return;
    }
    setSaving(true);
    const res = await api.resetConfig();
    setSaving(false);
    if (res.success && res.settings) {
      setSettings(res.settings);
      showToast('Settings reset to default values.');
    } else {
      showToast(res.error || 'Failed to reset settings', 'error');
    }
  };

  if (loading) {
    return (
      <div className="config-container loading">
        <div className="spinner"></div>
        <p>Loading configuration settings...</p>
      </div>
    );
  }

  return (
    <div className="config-container">
      {/* Toast Notification */}
      {toast && (
        <div className={`config-toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="config-header">
        <div>
          <h2>
            <SlidersHorizontal size={22} style={{ color: 'var(--accent-color)' }} />
            System Configuration
          </h2>
          <p className="config-subtitle">
            Tune reader behavior, token budgets, graph traversal heuristics, and memory decay policies.
          </p>
        </div>
        <div className="config-header-actions">
          <button 
            className="btn-secondary config-btn" 
            onClick={handleReset} 
            disabled={saving}
            title="Reset to factory defaults"
          >
            <RotateCcw size={16} />
            <span>Reset Defaults</span>
          </button>
          <button 
            className="btn-primary config-btn" 
            onClick={handleSave} 
            disabled={saving}
          >
            <Save size={16} />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      <div className="config-cards-grid">
        {/* Card 1: Reader Strategy & Token Budget */}
        <div className="config-card">
          <div className="config-card-header">
            <div className="config-card-title">
              <BookOpen size={18} style={{ color: 'var(--color-pattern)' }} />
              <h3>Super-Reader & Invariant Injection</h3>
            </div>
            <span className="config-card-badge">sd_read</span>
          </div>
          <p className="config-card-desc">
            Configure how source files are read and how architectural invariants are injected into agent contexts.
          </p>

          <div className="config-field">
            <div className="config-field-info">
              <label>Reader Tool Enabled</label>
              <span>Expose sd_read to the MCP agent tool catalog</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.readTool.enabled}
                onChange={(e) => setSettings({
                  ...settings,
                  readTool: { ...settings.readTool, enabled: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="config-field">
            <div className="config-field-info">
              <label>Highlight as Primary File Reader</label>
              <span>Instruct agents via imperative MCP docstrings and AGENTS.md to prioritize sd_read</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.readTool.highlightAsPrimary}
                onChange={(e) => setSettings({
                  ...settings,
                  readTool: { ...settings.readTool, highlightAsPrimary: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>


          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Reader Strategy Mode</label>
              <span>Integration policy for AST code compression and file reading</span>
            </div>
            <div className="segmented-group">
              {[
                { key: 'auto', label: 'Auto (TokenSave + Graph)', desc: 'Use TokenSave AST if available' },
                { key: 'standalone', label: 'Standalone', desc: 'Native line-numbered reader only' },
                { key: 'tokensave', label: 'TokenSave Required', desc: 'Enforce AST hologram compression' },
                { key: 'disabled', label: 'Disabled', desc: 'Only serve manual sd_recall' }
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`segmented-btn ${settings.readTool.mode === m.key ? 'active' : ''}`}
                  onClick={() => setSettings({
                    ...settings,
                    readTool: { ...settings.readTool, mode: m.key as any }
                  })}
                >
                  <span className="seg-title">{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Invariant Token Budget</label>
              <span>Maximum tokens allocated to topological invariants per file read</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="100" 
                max="2000" 
                step="50"
                value={settings.readTool.tokenBudget}
                onChange={(e) => setSettings({
                  ...settings,
                  readTool: { ...settings.readTool, tokenBudget: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{settings.readTool.tokenBudget} tokens</span>
            </div>
          </div>

          <div className="config-field">
            <div className="config-field-info">
              <label>Invariant Cache Policy</label>
              <span>Controls when topological context is re-injected during chunked reads</span>
            </div>
            <select
              className="config-select"
              value={settings.readTool.cachePolicy}
              onChange={(e) => setSettings({
                ...settings,
                readTool: { ...settings.readTool, cachePolicy: e.target.value as any }
              })}
            >
              <option value="first_read_only">First Read Only (Per Session)</option>
              <option value="always">Always Inject (Every Read)</option>
              <option value="on_file_changed">On File Mutation (SHA-256 Changed)</option>
            </select>
          </div>

          <div className="config-field">
            <div className="config-field-info">
              <label>Include AST Symbol Outlines</label>
              <span>Prepend exported classes, functions, and interface signatures</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.readTool.includeSymbols}
                onChange={(e) => setSettings({
                  ...settings,
                  readTool: { ...settings.readTool, includeSymbols: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>
        </div>

        {/* Card 2: Multi-Hop Graph Traversal */}
        <div className="config-card">
          <div className="config-card-header">
            <div className="config-card-title">
              <Cpu size={18} style={{ color: 'var(--color-codemap)' }} />
              <h3>Multi-Hop Graph Traversal (ACL Push)</h3>
            </div>
            <span className="config-card-badge">PageRank</span>
          </div>
          <p className="config-card-desc">
            Tune the asymmetric localized PageRank engine for blast-radius invariant recall.
          </p>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Downstream Dependency Weight</label>
              <span>Priority bias when following outgoing import edges (contracts & schemas)</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.10" 
                max="1.00" 
                step="0.05"
                value={settings.graph.forwardWeight}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, forwardWeight: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{(settings.graph.forwardWeight * 100).toFixed(0)}% ({settings.graph.forwardWeight.toFixed(2)})</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Upstream Caller Weight</label>
              <span>Priority bias when traversing incoming caller edges (consumers at risk)</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.05" 
                max="0.80" 
                step="0.05"
                value={settings.graph.reverseWeight}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, reverseWeight: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{(settings.graph.reverseWeight * 100).toFixed(0)}% ({settings.graph.reverseWeight.toFixed(2)})</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Cumulative Mass Threshold (1 - &delta;)</label>
              <span>Frontier retention percentage during sweep-cut truncation</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.50" 
                max="0.99" 
                step="0.01"
                value={settings.graph.cumulativeMassThreshold}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, cumulativeMassThreshold: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{(settings.graph.cumulativeMassThreshold * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Consolidation Threshold</label>
              <span>Micro-memory count on a file vertex required before triggering super-memory synthesis</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="2" 
                max="10" 
                step="1"
                value={settings.graph.consolidationThreshold}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, consolidationThreshold: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{settings.graph.consolidationThreshold} memories</span>
            </div>
          </div>
        </div>

        {/* Card 3: Confidence Decay & Integrity */}
        <div className="config-card">
          <div className="config-card-header">
            <div className="config-card-title">
              <ShieldAlert size={18} style={{ color: 'var(--color-lesson)' }} />
              <h3>Confidence Decay & File Hashing</h3>
            </div>
            <span className="config-card-badge">SHA-256</span>
          </div>
          <p className="config-card-desc">
            Controls automatic confidence decay when workspace files are modified or refactored.
          </p>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Code Mutation Decay Rate</label>
              <span>Confidence multiplier applied to attached memories when file content hash changes</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.50" 
                max="0.95" 
                step="0.05"
                value={settings.decay.decayRate}
                onChange={(e) => setSettings({
                  ...settings,
                  decay: { ...settings.decay, decayRate: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{(settings.decay.decayRate * 100).toFixed(0)}% retention</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Minimum Confidence Floor</label>
              <span>Hard minimum confidence threshold preventing memory eviction</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.10" 
                max="0.50" 
                step="0.05"
                value={settings.decay.minFloor}
                onChange={(e) => setSettings({
                  ...settings,
                  decay: { ...settings.decay, minFloor: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{(settings.decay.minFloor * 100).toFixed(0)}% floor</span>
            </div>
          </div>
        </div>

        {/* Card 4: Git Auto-Versioning */}
        <div className="config-card">
          <div className="config-card-header">
            <div className="config-card-title">
              <GitBranch size={18} style={{ color: 'var(--color-fact)' }} />
              <h3>Git Auto-Versioning & Concurrency</h3>
            </div>
            <span className="config-card-badge">Git</span>
          </div>
          <p className="config-card-desc">
            Manages background Git commit batching to prevent lockfile contention during rapid agent operations.
          </p>

          <div className="config-field">
            <div className="config-field-info">
              <label>Git Auto-Commit Enabled</label>
              <span>Track all memory creations, edits, and consolidations in Git history</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.git.enabled}
                onChange={(e) => setSettings({
                  ...settings,
                  git: { ...settings.git, enabled: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Commit Debounce Window</label>
              <span>Batching window aggregating rapid sequence writes into atomic commits</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0" 
                max="5000" 
                step="250"
                value={settings.git.debounceMs}
                onChange={(e) => setSettings({
                  ...settings,
                  git: { ...settings.git, debounceMs: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">
                {settings.git.debounceMs === 0 ? '0ms (Immediate)' : `${settings.git.debounceMs} ms`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigView;
