import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface DashboardProps {
  activeContext: string;
  dataVersion?: number;
}

const Dashboard: React.FC<DashboardProps> = ({ activeContext, dataVersion = 0 }) => {
  const [stats, setStats] = useState({ total: 0, lessons: 0, facts: 0, patterns: 0, warnings: 0, guides: 0, codemaps: 0 });

  useEffect(() => {
    if (!activeContext) return;
    const fetchStats = async () => {
      const memories = await api.getMemories(activeContext);
      
      const counts = { 
        total: memories.length, 
        lessons: 0, 
        facts: 0, 
        patterns: 0, 
        warnings: 0, 
        guides: 0, 
        codemaps: 0 
      };
      
      memories.forEach((m: any) => {
        if (m.type === 'lesson') counts.lessons++;
        else if (m.type === 'fact') counts.facts++;
        else if (m.type === 'pattern') counts.patterns++;
        else if (m.type === 'warning') counts.warnings++;
        else if (m.type === 'guide') counts.guides++;
        else if (m.type === 'codemap') counts.codemaps++;
      });
      setStats(counts);
    };
    fetchStats();
  }, [activeContext, dataVersion]);

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p style={{ color: 'var(--text-muted)' }}>Overview of <strong>{activeContext}</strong></p>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Total Memories</h3>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="card">
          <h3>Lessons Learned</h3>
          <div className="stat-value" style={{ color: 'var(--color-lesson)' }}>{stats.lessons}</div>
        </div>
        <div className="card">
          <h3>Facts Recorded</h3>
          <div className="stat-value" style={{ color: 'var(--color-fact)' }}>{stats.facts}</div>
        </div>
        <div className="card">
          <h3>Patterns & Invariants</h3>
          <div className="stat-value" style={{ color: 'var(--color-pattern)' }}>{stats.patterns}</div>
        </div>
        <div className="card">
          <h3>Warnings & Pitfalls</h3>
          <div className="stat-value" style={{ color: 'var(--color-warning)' }}>{stats.warnings}</div>
        </div>
        <div className="card">
          <h3>Guides & Codemaps</h3>
          <div className="stat-value" style={{ color: 'var(--color-guide)' }}>{stats.guides + stats.codemaps}</div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
