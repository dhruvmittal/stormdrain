import React, { useState, useEffect } from 'react';
import { Database, Network, LayoutDashboard, BrainCircuit } from 'lucide-react';
import Dashboard from './components/Dashboard';
import MemoryBrowser from './components/MemoryBrowser';
import GraphView from './components/GraphView';
import { api } from './api';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'browser' | 'graph'>('dashboard');
  const [contexts, setContexts] = useState<string[]>([]);
  const [activeContext, setActiveContext] = useState<string>('');

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

  const handleContextChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newContext = e.target.value;
    await api.setContext(newContext);
    setActiveContext(newContext);
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1><BrainCircuit size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Storm<span>Drain</span></h1>
        </div>
        
        <div className="nav-menu">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={18} /> Dashboard
          </div>
          <div 
            className={`nav-item ${activeTab === 'browser' ? 'active' : ''}`}
            onClick={() => setActiveTab('browser')}
          >
            <Database size={18} /> Memory Browser
          </div>
          <div 
            className={`nav-item ${activeTab === 'graph' ? 'active' : ''}`}
            onClick={() => setActiveTab('graph')}
          >
            <Network size={18} /> Graph View
          </div>
        </div>

        <div className="context-selector">
          <select value={activeContext} onChange={handleContextChange}>
            {contexts.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="main-content">
        {activeTab === 'dashboard' && <Dashboard activeContext={activeContext} />}
        {activeTab === 'browser' && <MemoryBrowser activeContext={activeContext} />}
        {activeTab === 'graph' && <GraphView activeContext={activeContext} />}
      </div>
    </div>
  );
}

export default App;
