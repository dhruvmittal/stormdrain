import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface DashboardProps {
  activeContext: string;
}

const Dashboard: React.FC<DashboardProps> = ({ activeContext }) => {
  const [stats, setStats] = useState({ total: 0, lessons: 0, facts: 0 });

  useEffect(() => {
    if (!activeContext) return;
    const fetchStats = async () => {
      const memories = await api.getMemories(activeContext);
      
      const counts = { total: memories.length, lessons: 0, facts: 0 };
      memories.forEach((m: any) => {
        if (m.type === 'lesson') counts.lessons++;
        if (m.type === 'fact') counts.facts++;
      });
      setStats(counts);
    };
    fetchStats();
  }, [activeContext]);

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p style={{ color: 'var(--text-muted)' }}>Overview of {activeContext}</p>
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
      </div>
    </div>
  );
};

export default Dashboard;
