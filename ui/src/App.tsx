import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Database, 
  Network, 
  LayoutDashboard, 
  BrainCircuit, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  Check, 
  SlidersHorizontal,
  RefreshCw
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import MemoryBrowser from './components/MemoryBrowser';
import GraphView from './components/GraphView';
import ConfigView from './components/ConfigView';
import { api, applyThemeColors } from './api';
import './index.css';

type Tab = 'dashboard' | 'browser' | 'graph' | 'settings';

const VALID_TABS: Tab[] = ['dashboard', 'browser', 'graph', 'settings'];

const LIVE_OPTIONS = [
  { value: 0, label: 'Off (Manual only)', shortLabel: 'Live: Off' },
  { value: 5000, label: 'Every 5 seconds', shortLabel: 'Live: 5s' },
  { value: 15000, label: 'Every 15 seconds', shortLabel: 'Live: 15s' },
  { value: 30000, label: 'Every 30 seconds', shortLabel: 'Live: 30s' },
  { value: 60000, label: 'Every 60 seconds', shortLabel: 'Live: 60s' },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    return (VALID_TABS.includes(hash as Tab) ? hash : 'dashboard') as Tab;
  });

  const [contexts, setContexts] = useState<string[]>([]);
  const [activeContext, setActiveContext] = useState<string>('');
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(() => {
    const saved = localStorage.getItem('stormdrain_auto_refresh');
    return saved ? Number(saved) : 0;
  });
  const [showLiveDropdown, setShowLiveDropdown] = useState<boolean>(false);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('stormdrain_sidebar_collapsed') === 'true';
  });
  const [showContextPopover, setShowContextPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const liveDropdownRef = useRef<HTMLDivElement>(null);

  // Sync tab with URL hash on popstate / hashchange (Browser Back / Forward / Refresh)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      if (VALID_TABS.includes(hash as Tab)) {
        setActiveTab(hash as Tab);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  const fetchContexts = async () => {
    const data = await api.getContexts();
    if (data) {
      setContexts(Object.keys(data.contexts));
      if (!activeContext) {
        setActiveContext(data.active);
      }
    }
  };

  useEffect(() => {
    fetchContexts();
    api.getConfig().then(cfg => {
      if (cfg?.colors) {
        applyThemeColors(cfg.colors);
      }
    });
  }, []);

  // Soft-refresh dispatcher across all views
  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    setDataVersion(v => v + 1);
    try {
      await fetchContexts();
      const cfg = await api.getConfig();
      if (cfg?.colors) {
        applyThemeColors(cfg.colors);
      }
    } catch {
      // Ignore network errors on refresh
    }
    setTimeout(() => setIsRefreshing(false), 450);
  }, [activeContext]);

  // Periodic Auto-Refresh Poller (Live Mode)
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setDataVersion(v => v + 1);
      }
    }, autoRefreshInterval);

    return () => clearInterval(timer);
  }, [autoRefreshInterval]);

  const handleAutoRefreshChange = (intervalMs: number) => {
    setAutoRefreshInterval(intervalMs);
    localStorage.setItem('stormdrain_auto_refresh', String(intervalMs));
  };

  const getLiveOptionLabel = (ms: number) => {
    const found = LIVE_OPTIONS.find(o => o.value === ms);
    return found ? found.shortLabel : `Live: ${ms / 1000}s`;
  };

  // Global Keyboard Shortcut: 'r' to soft-refresh when not focused on an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.tagName === 'SELECT' || 
        target.isContentEditable
      );
      if (!isInput && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        refreshData();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refreshData]);

  useEffect(() => {
    localStorage.setItem('stormdrain_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  // Click outside listener for context popover and live dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setShowContextPopover(false);
      }
      if (liveDropdownRef.current && !liveDropdownRef.current.contains(target)) {
        setShowLiveDropdown(false);
      }
    };
    if (showContextPopover || showLiveDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showContextPopover, showLiveDropdown]);

  const handleContextSelect = async (newContext: string) => {
    await api.setContext(newContext);
    setActiveContext(newContext);
    setShowContextPopover(false);
    setDataVersion(v => v + 1);
  };

  const getContextInitials = (ctx: string) => {
    if (!ctx) return 'SD';
    if (ctx === '_global') return 'GL';
    const parts = ctx.split(/[-_ ]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return ctx.substring(0, 2).toUpperCase();
  };

  const getTabLabel = (tab: Tab) => {
    switch (tab) {
      case 'dashboard': return 'Dashboard';
      case 'browser': return 'Memory Browser';
      case 'graph': return 'Graph View';
      case 'settings': return 'Configuration';
    }
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
            onClick={() => handleTabChange('dashboard')}
            data-tooltip="Dashboard"
          >
            <LayoutDashboard size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Dashboard</span>}
          </div>
          <div 
            className={`nav-item ${activeTab === 'browser' ? 'active' : ''}`}
            onClick={() => handleTabChange('browser')}
            data-tooltip="Memory Browser"
          >
            <Database size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Memory Browser</span>}
          </div>
          <div 
            className={`nav-item ${activeTab === 'graph' ? 'active' : ''}`}
            onClick={() => handleTabChange('graph')}
            data-tooltip="Graph View"
          >
            <Network size={18} style={{ flexShrink: 0 }} /> 
            {!collapsed && <span>Graph View</span>}
          </div>
          <div 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => handleTabChange('settings')}
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
        {/* Universal Top HUD Command Bar */}
        <div className="top-hud-bar">
          <div className="top-hud-left">
            <span className="top-hud-title">{getTabLabel(activeTab)}</span>
            <span className="top-hud-context-pill">{activeContext}</span>
          </div>

          <div className="top-hud-right">
            {/* Soft-Refresh Action Button */}
            <button 
              className="hud-action-btn"
              onClick={refreshData}
              title="Soft-refresh data across all views (Shortcut: r)"
            >
              <RefreshCw size={13} className={isRefreshing ? 'spin-anim' : ''} />
              <span>Refresh</span>
              <kbd className="hud-shortcut-hint">R</kbd>
            </button>

            {/* Custom Glassmorphic Live Auto-Polling Popover */}
            <div className="hud-live-dropdown-container" ref={liveDropdownRef}>
              <button 
                className={`hud-live-trigger-btn ${showLiveDropdown ? 'open' : ''} ${autoRefreshInterval > 0 ? 'active' : ''}`}
                onClick={() => setShowLiveDropdown(!showLiveDropdown)}
                title="Toggle periodic live data refresh"
              >
                <div className={`hud-live-dot ${autoRefreshInterval > 0 ? 'active' : ''}`} />
                <span>{getLiveOptionLabel(autoRefreshInterval)}</span>
                <ChevronDown size={13} className={`hud-dropdown-chevron ${showLiveDropdown ? 'rotate' : ''}`} />
              </button>

              {showLiveDropdown && (
                <div className="hud-popover-menu">
                  <div className="hud-popover-title">Live Auto-Sync</div>
                  {LIVE_OPTIONS.map((opt) => (
                    <div
                      key={opt.value}
                      className={`hud-popover-item ${autoRefreshInterval === opt.value ? 'active' : ''}`}
                      onClick={() => {
                        handleAutoRefreshChange(opt.value);
                        setShowLiveDropdown(false);
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className={`hud-popover-dot ${opt.value > 0 ? 'green' : 'gray'} ${autoRefreshInterval === opt.value ? 'selected' : ''}`} />
                        <span>{opt.label}</span>
                      </div>
                      {autoRefreshInterval === opt.value && <Check size={14} style={{ color: 'var(--accent-hover)' }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* View Routing with Shared dataVersion */}
        {activeTab === 'dashboard' && <Dashboard activeContext={activeContext} dataVersion={dataVersion} />}
        {activeTab === 'browser' && <MemoryBrowser activeContext={activeContext} dataVersion={dataVersion} />}
        {activeTab === 'graph' && <GraphView activeContext={activeContext} dataVersion={dataVersion} />}
        {activeTab === 'settings' && <ConfigView dataVersion={dataVersion} onConfigSaved={refreshData} />}
      </div>
    </div>
  );
}

export default App;
