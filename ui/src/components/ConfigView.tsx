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
  SlidersHorizontal,
  Palette,
  Sparkles
} from 'lucide-react';
import { api, applyThemeColors, type StormDrainSettings, type GraphColorSettings } from '../api';


const PALETTE_PRESETS: Array<{ name: string; desc: string; colors: GraphColorSettings }> = [
  {
    name: 'Cyberpunk Neon',
    desc: 'Electric blues, cyans, ambers, and purples',
    colors: {
      nodes: {
        concept: '#38bdf8',
        codemap: '#06b6d4',
        fact: '#10b981',
        lesson: '#f59e0b',
        pattern: '#8b5cf6',
        warning: '#ef4444',
        guide: '#ec4899',
        sequence: '#6366f1'
      },
      edges: {
        imports: '#38bdf8',
        affects: '#38bdf8',
        applies_to: '#0ea5e9',
        supports: '#10b981',
        contradicts: '#ef4444',
        supersedes: '#f59e0b',
        related_to: '#94a3b8',
        references: '#a855f7',
        depends_on: '#6366f1',
        part_of: '#ec4899',
        distilled_from: '#8b5cf6',
        defaultEdge: '#334155'
      },
      highlight: '#fbbf24'
    }
  },
  {
    name: 'Oceanic Teal',
    desc: 'Deep marine blues, teals, emeralds, and aquas',
    colors: {
      nodes: {
        concept: '#0284c7',
        codemap: '#0d9488',
        fact: '#059669',
        lesson: '#d97706',
        pattern: '#0369a1',
        warning: '#e11d48',
        guide: '#2dd4bf',
        sequence: '#2563eb'
      },
      edges: {
        imports: '#0d9488',
        affects: '#0284c7',
        applies_to: '#0d9488',
        supports: '#059669',
        contradicts: '#e11d48',
        supersedes: '#d97706',
        related_to: '#64748b',
        references: '#38bdf8',
        depends_on: '#2563eb',
        part_of: '#2dd4bf',
        distilled_from: '#0ea5e9',
        defaultEdge: '#1e293b'
      },
      highlight: '#38bdf8'
    }
  },
  {
    name: 'Sunset Amber',
    desc: 'Warm ambers, corals, crimsons, and golden sands',
    colors: {
      nodes: {
        concept: '#f97316',
        codemap: '#fb923c',
        fact: '#84cc16',
        lesson: '#eab308',
        pattern: '#a855f7',
        warning: '#dc2626',
        guide: '#f43f5e',
        sequence: '#d97706'
      },
      edges: {
        imports: '#fb923c',
        affects: '#f97316',
        applies_to: '#fb923c',
        supports: '#84cc16',
        contradicts: '#dc2626',
        supersedes: '#eab308',
        related_to: '#78716c',
        references: '#a855f7',
        depends_on: '#d97706',
        part_of: '#f43f5e',
        distilled_from: '#f59e0b',
        defaultEdge: '#292524'
      },
      highlight: '#facc15'
    }
  },
  {
    name: 'Monochrome Slate',
    desc: 'Minimal high-contrast slates and silvers',
    colors: {
      nodes: {
        concept: '#94a3b8',
        codemap: '#cbd5e1',
        fact: '#64748b',
        lesson: '#e2e8f0',
        pattern: '#94a3b8',
        warning: '#f87171',
        guide: '#f1f5f9',
        sequence: '#475569'
      },
      edges: {
        imports: '#cbd5e1',
        affects: '#94a3b8',
        applies_to: '#cbd5e1',
        supports: '#64748b',
        contradicts: '#f87171',
        supersedes: '#e2e8f0',
        related_to: '#334155',
        references: '#94a3b8',
        depends_on: '#475569',
        part_of: '#f1f5f9',
        distilled_from: '#64748b',
        defaultEdge: '#1e293b'
      },
      highlight: '#cbd5e1'
    }
  }
];

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
    consolidationThreshold: 3,
    performanceThreshold: 500,
    repulsionDistanceMax: 200,
    repulsionTheta: 0.95,
    labelMode: 'dynamic',
    labelFilter: 'all',
    labelTextBacking: true,
    highlightNewest: false,
    highlightTimeout: 2,
    attenuateInterModule: true,
    freezeOutOfScopeNodes: true,
    interModuleTensionRatio: 0.25,
    memoryChargeStrength: -140
  },
  decay: {
    decayRate: 0.85,
    minFloor: 0.30
  },
  git: {
    enabled: true,
    debounceMs: 1500
  },
  colors: {
    nodes: {
      concept: '#38bdf8',
      codemap: '#06b6d4',
      fact: '#10b981',
      lesson: '#f59e0b',
      pattern: '#8b5cf6',
      warning: '#ef4444',
      guide: '#ec4899',
      sequence: '#6366f1'
    },
    edges: {
      imports: '#38bdf8',
      affects: '#a855f7',
      applies_to: '#a855f7',
      supports: '#10b981',
      contradicts: '#ef4444',
      supersedes: '#f59e0b',
      depends_on: '#6366f1',
      references: '#64748b',
      related_to: '#64748b',
      part_of: '#ec4899',
      distilled_from: '#8b5cf6',
      defaultEdge: '#334155'
    },
    highlight: '#fbbf24'
  }
};

interface ConfigViewProps {
  dataVersion?: number;
  onConfigSaved?: () => void;
}

export const ConfigView: React.FC<ConfigViewProps> = ({ dataVersion = 0, onConfigSaved }) => {
  const [settings, setSettings] = useState<StormDrainSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const isInitialLoadRef = React.useRef<boolean>(true);
  const isDirtyRef = React.useRef<boolean>(false);

  useEffect(() => {
    loadSettings();
  }, [dataVersion]);

  const loadSettings = async (force: boolean = false) => {
    if (isInitialLoadRef.current) {
      setLoading(true);
    }
    try {
      const data = await api.getConfig();
      if (data) {
        if (force || !isDirtyRef.current || isInitialLoadRef.current) {
          setSettings(data);
          if (data.colors) {
            applyThemeColors(data.colors);
          }
          if (force || isInitialLoadRef.current) {
            isDirtyRef.current = false;
          }
        }
      }
    } catch {
      // Ignore network errors
    } finally {
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        setLoading(false);
      }
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const updateNodeColor = (key: string, value: string) => {
    isDirtyRef.current = true;
    setSettings(prev => {
      const currentNodes = prev.colors?.nodes || DEFAULT_SETTINGS.colors!.nodes;
      const currentEdges = prev.colors?.edges || DEFAULT_SETTINGS.colors!.edges;
      const newColors: GraphColorSettings = {
        nodes: { ...DEFAULT_SETTINGS.colors!.nodes, ...currentNodes, [key]: value },
        edges: { ...DEFAULT_SETTINGS.colors!.edges, ...currentEdges }
      };
      applyThemeColors(newColors);
      return {
        ...prev,
        colors: newColors
      };
    });
  };

  const updateEdgeColor = (key: string, value: string) => {
    isDirtyRef.current = true;
    setSettings(prev => {
      const currentNodes = prev.colors?.nodes || DEFAULT_SETTINGS.colors!.nodes;
      const currentEdges = prev.colors?.edges || DEFAULT_SETTINGS.colors!.edges;
      const newColors: GraphColorSettings = {
        nodes: { ...DEFAULT_SETTINGS.colors!.nodes, ...currentNodes },
        edges: { ...DEFAULT_SETTINGS.colors!.edges, ...currentEdges, [key]: value }
      };
      applyThemeColors(newColors);
      return {
        ...prev,
        colors: newColors
      };
    });
  };

  const applyPreset = (preset: typeof PALETTE_PRESETS[0]) => {
    isDirtyRef.current = true;
    const newColors: GraphColorSettings = JSON.parse(JSON.stringify(preset.colors));
    setSettings(prev => ({
      ...prev,
      colors: newColors
    }));
    applyThemeColors(newColors);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateConfig(settings);
      if (res.success && res.settings) {
        isDirtyRef.current = false;
        setSettings(res.settings);
        if (res.settings.colors) {
          applyThemeColors(res.settings.colors);
        }
        onConfigSaved?.();
        showToast('Settings saved and applied successfully!');
      } else {
        showToast(res.error || 'Failed to save settings', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all configuration options to their default values?')) {
      return;
    }
    setSaving(true);
    try {
      const res = await api.resetConfig();
      if (res.success && res.settings) {
        isDirtyRef.current = false;
        setSettings(res.settings);
        if (res.settings.colors) {
          applyThemeColors(res.settings.colors);
        }
        onConfigSaved?.();
        showToast('Settings reset to default values.');
      } else {
        showToast(res.error || 'Failed to reset settings', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to reset settings', 'error');
    } finally {
      setSaving(false);
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

        {/* Card 5: Graph Performance & Scalability */}
        <div className="config-card">
          <div className="config-card-header">
            <div className="config-card-title">
              <Cpu size={18} style={{ color: 'var(--color-warning)' }} />
              <h3>Graph Performance & Scalability</h3>
            </div>
            <span className="config-card-badge">Performance</span>
          </div>
          <p className="config-card-desc">
            Optimize D3 rendering thresholds and force simulation parameters to handle large-scale codebases.
          </p>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Transition Bypass Threshold</label>
              <span>Bypass SVG opacity animations above this node count to prevent main-thread lag</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="100" 
                max="2000" 
                step="50"
                value={settings.graph.performanceThreshold ?? 500}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, performanceThreshold: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{settings.graph.performanceThreshold ?? 500} nodes</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Repulsion Max Distance</label>
              <span>Cap electrostatic repulsion calculations to a local bounding radius</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="50" 
                max="500" 
                step="10"
                value={settings.graph.repulsionDistanceMax ?? 200}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, repulsionDistanceMax: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{settings.graph.repulsionDistanceMax ?? 200} px</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Barnes-Hut Theta (&theta;)</label>
              <span>Higher values group distant force computations coarser and faster</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.50" 
                max="1.00" 
                step="0.05"
                value={settings.graph.repulsionTheta ?? 0.95}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, repulsionTheta: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{(settings.graph.repulsionTheta ?? 0.95).toFixed(2)}</span>
            </div>
          </div>

          <div className="config-field">
            <div className="config-field-info">
              <label>Attenuate Inter-Module Header Dependencies</label>
              <span>Relax link tension between different C++ modules to prevent module collapse</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.graph.attenuateInterModule ?? true}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, attenuateInterModule: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Inter-Module Tension Ratio</label>
              <span>Link strength multiplier applied to cross-module edges relative to intra-module edges</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="0.05" 
                max="1.00" 
                step="0.05"
                value={settings.graph.interModuleTensionRatio ?? 0.25}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, interModuleTensionRatio: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{((settings.graph.interModuleTensionRatio ?? 0.25) * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="config-field">
            <div className="config-field-info">
              <label>Freeze Subgraph Physics in Focus Mode</label>
              <span>Pin out-of-scope nodes during Focus Mode to eliminate background CPU tick overhead</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.graph.freezeOutOfScopeNodes ?? true}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, freezeOutOfScopeNodes: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Default Memory Node Repulsion</label>
              <span>Repulsive charge strength between attached memory nodes</span>
            </div>
            <div className="range-control">
              <input 
                type="range" 
                min="-400" 
                max="-10" 
                step="10"
                value={settings.graph.memoryChargeStrength ?? -140}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, memoryChargeStrength: Number(e.target.value) }
                })}
              />
              <span className="range-val-badge">{settings.graph.memoryChargeStrength ?? -140}</span>
            </div>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Default Label Mode</label>
              <span>Choose between displaying all labels or dynamic (landmarks + hover) mode</span>
            </div>
            <select
              value={settings.graph.labelMode ?? 'dynamic'}
              onChange={(e) => setSettings({
                ...settings,
                graph: { ...settings.graph, labelMode: e.target.value as any }
              })}
              style={{
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '4px',
                color: 'var(--text-main)',
                padding: '6px 10px',
                cursor: 'pointer',
                outline: 'none',
                width: '100%'
              }}
            >
              <option value="all">Show All Text</option>
              <option value="dynamic">Dynamic (Landmarks + Hover)</option>
              <option value="hover-only">Hover-Only Lens (No Landmarks)</option>
            </select>
          </div>

          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Default Visibility Filter</label>
              <span>Choose whether to apply dynamic layout culling to all nodes, or keep memories always visible and only filter file nodes</span>
            </div>
            <select
              value={settings.graph.labelFilter ?? 'all'}
              onChange={(e) => setSettings({
                ...settings,
                graph: { ...settings.graph, labelFilter: e.target.value as any }
              })}
              style={{
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '4px',
                color: 'var(--text-main)',
                padding: '6px 10px',
                cursor: 'pointer',
                outline: 'none',
                width: '100%'
              }}
            >
              <option value="all">Apply Mode to All Nodes</option>
              <option value="always-show-memories">Always Show Memories (Dynamic Files)</option>
            </select>
          </div>

          <div className="config-field" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 0 0' }}>
            <div className="config-field-info" style={{ flex: '1', paddingRight: '12px' }}>
              <label style={{ margin: '0' }}>Default Dark Text Backing (Halo)</label>
              <span>Render outlines behind labels to prevent overlaps with links</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.graph.labelTextBacking !== false}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, labelTextBacking: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="config-field" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 0 0' }}>
            <div className="config-field-info" style={{ flex: '1', paddingRight: '12px' }}>
              <label style={{ margin: '0' }}>Default Focus Mode (Sub-graph Neighborhood)</label>
              <span>Physically prune non-focused nodes and layout only the matching neighborhood during active queries</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.graph.labelFocusMode === true}
                onChange={(e) => setSettings({
                  ...settings,
                  graph: { ...settings.graph, labelFocusMode: e.target.checked }
                })}
              />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="config-field" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 0 0' }}>
            <div className="config-field-info" style={{ flex: '1', paddingRight: '12px' }}>
              <label style={{ margin: '0' }}>Default Highlight Newest Changes</label>
              <span>Pull the user's eye to the most recently updated and created nodes in the graph view</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={settings.graph.highlightNewest === true}
                onChange={(e) => {
                  isDirtyRef.current = true;
                  setSettings({
                    ...settings,
                    graph: { ...settings.graph, highlightNewest: e.target.checked }
                  });
                }}
              />
              <span className="slider round"></span>
            </label>
          </div>

          {settings.graph.highlightNewest && (
            <div className="config-field" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 0 0', paddingLeft: '16px', borderLeft: '2px solid var(--accent-color)' }}>
              <div className="config-field-info" style={{ flex: '1', paddingRight: '12px' }}>
                <label style={{ margin: '0' }}>Highlight Timeout (Minutes)</label>
                <span>Automatically remove visual highlight after N minutes of inactivity</span>
              </div>
              <input 
                type="number" 
                min="1" 
                max="60" 
                style={{ width: '80px', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input)', color: 'var(--text-main)' }}
                value={settings.graph.highlightTimeout ?? 2}
                onChange={(e) => {
                  isDirtyRef.current = true;
                  const val = parseInt(e.target.value, 10);
                  setSettings({
                    ...settings,
                    graph: { ...settings.graph, highlightTimeout: isNaN(val) ? 2 : val }
                  });
                }}
              />
            </div>
          )}
        </div>

        {/* Card 6: Graph Appearance & Palette */}
        <div className="config-card full-width">
          <div className="config-card-header">
            <div className="config-card-title">
              <Palette size={18} style={{ color: 'var(--color-guide)' }} />
              <h3>Graph Appearance & Color Customization</h3>
            </div>
            <span className="config-card-badge">Visuals</span>
          </div>
          <p className="config-card-desc">
            Customize node type colors and semantic edge relationship colors rendered in the interactive D3 knowledge graph.
          </p>

          {/* Theme Presets */}
          <div className="config-field vertical">
            <div className="config-field-info">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} style={{ color: 'var(--accent-color)' }} />
                Palette Presets
              </label>
              <span>Apply curated color schemes across all node types and relationship edges</span>
            </div>
            <div className="segmented-group presets-grid">
              {PALETTE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="segmented-btn preset-btn"
                  onClick={() => applyPreset(preset)}
                  title={preset.desc}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: preset.colors.nodes.concept }}></span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: preset.colors.nodes.fact }}></span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: preset.colors.nodes.pattern }}></span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: preset.colors.nodes.warning }}></span>
                    </div>
                    <span className="seg-title">{preset.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Node Colors */}
          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Node Types Palette</label>
              <span>Custom color mapping for knowledge nodes and file vertices</span>
            </div>
            <div className="colors-grid">
              {[
                { key: 'concept', label: 'Concept', desc: 'Mental models & abstract knowledge' },
                { key: 'codemap', label: 'Codemap (Source File)', desc: 'Source file vertices in codebase DAG' },
                { key: 'fact', label: 'Fact', desc: 'Invariants & configuration rules' },
                { key: 'lesson', label: 'Lesson', desc: 'Post-incident takeaways' },
                { key: 'pattern', label: 'Pattern', desc: 'Design blueprints & architectural recipes' },
                { key: 'warning', label: 'Warning', desc: 'Failure modes, traps & gotchas' },
                { key: 'guide', label: 'Guide', desc: 'Consolidated super-memories' },
                { key: 'sequence', label: 'Sequence', desc: 'Step-by-step procedures' },
              ].map((item) => {
                const nodeColors = settings.colors?.nodes || DEFAULT_SETTINGS.colors!.nodes;
                const currentColor = (nodeColors as any)[item.key] || '#38bdf8';
                return (
                  <div key={item.key} className="color-swatch-item">
                    <div className="color-swatch-left">
                      <input
                        type="color"
                        className="color-input"
                        value={currentColor}
                        onChange={(e) => updateNodeColor(item.key, e.target.value)}
                      />
                      <div className="color-label-group">
                        <span className="color-name">{item.label}</span>
                        <span className="color-desc">{item.desc}</span>
                      </div>
                    </div>
                    <code className="color-hex">{currentColor.toUpperCase()}</code>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Edge Colors */}
          <div className="config-field vertical">
            <div className="config-field-info">
              <label>Edge Relations Palette</label>
              <span>Custom color mapping for semantic relationship links</span>
            </div>
            <div className="colors-grid">
              {[
                { key: 'imports', label: 'imports', desc: 'File-to-file code dependency' },
                { key: 'affects', label: 'affects', desc: 'Impacts target file or system' },
                { key: 'applies_to', label: 'applies_to', desc: 'Applies to specific scope' },
                { key: 'supports', label: 'supports', desc: 'Validates or reinforces evidence' },
                { key: 'contradicts', label: 'contradicts', desc: 'Opposes or refutes claim' },
                { key: 'supersedes', label: 'supersedes', desc: 'Replaces older memory' },
                { key: 'depends_on', label: 'depends_on', desc: 'Hard architectural dependency' },
                { key: 'references', label: 'references', desc: 'Direct citation or mention' },
                { key: 'related_to', label: 'related_to', desc: 'General associative link' },
                { key: 'part_of', label: 'part_of', desc: 'Hierarchical component' },
                { key: 'distilled_from', label: 'distilled_from', desc: 'Super-memory provenance' },
                { key: 'defaultEdge', label: 'default', desc: 'Fallback unclassified link' },
              ].map((item) => {
                const edgeColors = settings.colors?.edges || DEFAULT_SETTINGS.colors!.edges;
                const currentColor = (edgeColors as any)[item.key] || '#38bdf8';
                return (
                  <div key={item.key} className="color-swatch-item">
                    <div className="color-swatch-left">
                      <input
                        type="color"
                        className="color-input"
                        value={currentColor}
                        onChange={(e) => updateEdgeColor(item.key, e.target.value)}
                      />
                      <div className="color-label-group">
                        <span className="color-name">--({item.label})--&gt;</span>
                        <span className="color-desc">{item.desc}</span>
                      </div>
                    </div>
                    <code className="color-hex">{currentColor.toUpperCase()}</code>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Highlight Color Customization */}
          <div className="config-field vertical" style={{ marginTop: '16px' }}>
            <div className="config-field-info">
              <label>Newest Change Highlight Color</label>
              <span>Custom accent color for nodes, rings, and links highlighting the latest modifications</span>
            </div>
            <div className="colors-grid">
              <div className="color-swatch-item">
                <div className="color-swatch-left">
                  <input
                    type="color"
                    className="color-input"
                    value={settings.colors?.highlight || '#fbbf24'}
                    onChange={(e) => {
                      isDirtyRef.current = true;
                      setSettings({
                        ...settings,
                        colors: {
                          ...settings.colors,
                          nodes: settings.colors?.nodes || DEFAULT_SETTINGS.colors!.nodes,
                          edges: settings.colors?.edges || DEFAULT_SETTINGS.colors!.edges,
                          highlight: e.target.value
                        }
                      });
                    }}
                  />
                  <div className="color-label-group">
                    <span className="color-name">Highlight Color</span>
                    <span className="color-desc">Used for gold glowing drop-shadows and outer dashed rings</span>
                  </div>
                </div>
                <code className="color-hex">{(settings.colors?.highlight || '#fbbf24').toUpperCase()}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigView;
