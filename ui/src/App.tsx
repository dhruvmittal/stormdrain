import { useState, useEffect, useRef } from 'react';
import { Database, Network, LayoutDashboard, BrainCircuit, ChevronLeft, ChevronRight, Check, SlidersHorizontal } from 'lucide-react';
import Dashboard from './components/Dashboard';
import MemoryBrowser from './components/MemoryBrowser';
import GraphView from './components/GraphView';
import ConfigView from './components/ConfigView';
import { api } from './api';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'browser' | 'graph' | 'settings'>('dashboard');
  const [contexts, setContexts] = useState<string[]>([]);
  const [activeContext, setActiveContext] = useState<string>('');
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('stormdrain_sidebar_collapsed') === 'true';
  });
  const [showContextPopover, setShowContextPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchContexts = async () => {
      const data = await api.getContexts();
      if (data) {
        setContexts(Object.keys(data.contexts));
        setActiveContext(data.active);
      }
    };
    fetchContexts();
  }, []);

  useEffect(() => {
    localStorage.setItem('stormdrain_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  // Click outside listener for context popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowContextPopover(false);
      }
    };
    if (showContextPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showContextPopover]);

  const handleContextSelect = async (newContext: string) => {
    await api.setContext(newContext);
    setActiveContext(newContext);
    setShowContextPopover(false);
  };

  const getContextInitials = (ctx: string) => {
    if (!ctx) return 'SD';
    if (ctx === '_global') return 'GL';
    const parts = ctx.split(/[-_ ]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return ctx.substring(0, 2).toUpperCase();
  };

  return (
    <div className="app-container">
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {!collapsed ? (
            <>
              <h1>
                <BrainCircuit size={20} style={{ color: 'var(--accent-color)', flexShrink: 0 }} /> 
                Storm<span>Drain</span>
              </h1>
              <button 
                className="sidebar-toggle-btn" 
                onClick={() => setCollapsed(true)} 
                title="Collapse sidebar"
              >
                <ChevronLeft size={18} />
              </button>
            </>
          ) : (
            <button 
              className="sidebar-toggle-btn" 
              style={{ margin: '0 auto' }}
              onClick={() => setCollapsed(false)} 
              title="Expand sidebar"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>
        
        <div className="nav-menu">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
            data-tooltip="Dashboard"
          >
            <LayoutDashboard size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Dashboard</span>}
          </div>
          <div 
            className={`nav-item ${activeTab === 'browser' ? 'active' : ''}`}
            onClick={() => setActiveTab('browser')}
            data-tooltip="Memory Browser"
          >
            <Database size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Memory Browser</span>}
          </div>
          <div 
            className={`nav-item ${activeTab === 'graph' ? 'active' : ''}`}
            onClick={() => setActiveTab('graph')}
            data-tooltip="Graph View"
          >
            <Network size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Graph View</span>}
          </div>
          <div 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            data-tooltip="Configuration"
          >
            <SlidersHorizontal size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Configuration</span>}
          </div>
        </div>

        <div className="context-selector" ref={popoverRef}>
          {!collapsed ? (
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
                Active Workspace
              </div>
              <select value={activeContext} onChange={(e) => handleContextSelect(e.target.value)}>
                {contexts.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <button 
                className="context-badge-btn" 
                onClick={() => setShowContextPopover(!showContextPopover)}
                title={`Active: ${activeContext} (Click to switch)`}
              >
                {getContextInitials(activeContext)}
              </button>

              {showContextPopover && (
                <div className="context-popover">
                  <div className="context-popover-title">Workspaces</div>
                  {contexts.map(c => (
                    <div 
                      key={c} 
                      className={`context-popover-item ${c === activeContext ? 'active' : ''}`}
                      onClick={() => handleContextSelect(c)}
                    >
                      <span>{c}</span>
                      {c === activeContext && <Check size={14} style={{ color: 'var(--accent-hover)' }} />}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="main-content">
        {activeTab === 'dashboard' && <Dashboard activeContext={activeContext} />}
        {activeTab === 'browser' && <MemoryBrowser activeContext={activeContext} />}
        {activeTab === 'graph' && <GraphView activeContext={activeContext} />}
        {activeTab === 'settings' && <ConfigView />}
      </div>
    </div>
  );
}

export default App;

