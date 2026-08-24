import React, { useEffect, useState } from 'react';
import { 
  Activity, 
  TrendingUp, 
  ShieldAlert, 
  FileCode, 
  Clock, 
  Sparkles, 
  ArrowUpRight, 
  Zap,
  CheckCircle2,
  Brain,
  ShieldCheck,
  FolderGit2
} from 'lucide-react';
import { api, type DashboardStats } from '../api';

interface DashboardProps {
  activeContext: string;
  dataVersion?: number;
}

const Dashboard: React.FC<DashboardProps> = ({ activeContext, dataVersion = 0 }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [consolidatingFile, setConsolidatingFile] = useState<string | null>(null);
  const [consolidationSuccess, setConsolidationSuccess] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!activeContext) return;
    setLoading(true);
    const data = await api.getStats(activeContext);
    setStats(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, [activeContext, dataVersion]);

  const handleConsolidate = async (targetFile: string) => {
    setConsolidatingFile(targetFile);
    setConsolidationSuccess(null);
    const res = await api.consolidate(activeContext, targetFile);
    setConsolidatingFile(null);
    if (res?.consolidatedId) {
      setConsolidationSuccess(`Synthesized ${res.mergedCount} micro-memories for ${targetFile.split('/').pop()}`);
      setTimeout(() => setConsolidationSuccess(null), 4000);
      fetchStats();
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'var(--color-fact)';
    if (score >= 60) return 'var(--color-lesson)';
    return 'var(--color-warning)';
  };

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return 'recently';
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (loading && !stats) {
    return (
      <div className="dashboard-view-container loading">
        <div className="spin-anim">
          <Activity size={32} style={{ color: 'var(--accent-color)' }} />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Aggregating knowledge stats for {activeContext}...</p>
      </div>
    );
  }

  const defensiveCount = (stats?.counts.warning || 0) + (stats?.counts.lesson || 0) + (stats?.counts.pattern || 0);
  const structuralCount = (stats?.counts.fact || 0) + (stats?.counts.concept || 0) + (stats?.counts.guide || 0) + (stats?.counts.sequence || 0);
  const totalTyped = defensiveCount + structuralCount;
  const defensivePct = totalTyped > 0 ? Math.round((defensiveCount / totalTyped) * 100) : 50;

  return (
    <div className="dashboard-view-container">
      {consolidationSuccess && (
        <div className="dashboard-toast success">
          <CheckCircle2 size={16} />
          <span>{consolidationSuccess}</span>
        </div>
      )}

      {/* KPI Header Grid */}
      <div className="dashboard-kpi-grid">
        {/* KPI 1: Graph Health Score */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Graph Health Score</span>
            <ShieldCheck size={20} style={{ color: getHealthColor(stats?.graphHealthScore ?? 100) }} />
          </div>
          <div className="kpi-body">
            <div className="kpi-value" style={{ color: getHealthColor(stats?.graphHealthScore ?? 100) }}>
              {stats?.graphHealthScore ?? 100}%
            </div>
            <div className="kpi-progress-bg">
              <div 
                className="kpi-progress-fill" 
                style={{ 
                  width: `${stats?.graphHealthScore ?? 100}%`, 
                  backgroundColor: getHealthColor(stats?.graphHealthScore ?? 100) 
                }} 
              />
            </div>
          </div>
          <div className="kpi-footer">
            <span>Average SHA-256 Memory Confidence</span>
          </div>
        </div>

        {/* KPI 2: Knowledge Velocity */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">7-Day Velocity</span>
            <TrendingUp size={20} style={{ color: 'var(--color-concept)' }} />
          </div>
          <div className="kpi-body">
            <div className="kpi-value" style={{ color: 'var(--color-concept)' }}>
              +{stats?.velocity.last7d ?? 0}
            </div>
            <div className="kpi-subtitle-badge">
              <Sparkles size={12} />
              <span>{stats?.velocity.last24h ?? 0} in last 24h</span>
            </div>
          </div>
          <div className="kpi-footer">
            <span>{stats?.velocity.last30d ?? 0} additions in past 30 days</span>
          </div>
        </div>

        {/* KPI 3: Consolidation Backlog */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Consolidation Backlog</span>
            <Zap size={20} style={{ color: (stats?.backlog.candidateCount ?? 0) > 0 ? 'var(--color-lesson)' : 'var(--text-muted)' }} />
          </div>
          <div className="kpi-body">
            <div className="kpi-value" style={{ color: (stats?.backlog.candidateCount ?? 0) > 0 ? 'var(--color-lesson)' : 'var(--text-muted)' }}>
              {stats?.backlog.candidateCount ?? 0}
            </div>
            <div className="kpi-subtitle-badge warning">
              <span>{stats?.backlog.unconsolidatedCount ?? 0} raw micro-memories</span>
            </div>
          </div>
          <div className="kpi-footer">
            <span>File vertices with &ge;3 micro-memories</span>
          </div>
        </div>

        {/* KPI 4: Codebase Coverage */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Codebase Coverage</span>
            <FolderGit2 size={20} style={{ color: 'var(--color-codemap)' }} />
          </div>
          <div className="kpi-body">
            <div className="kpi-value" style={{ color: 'var(--color-codemap)' }}>
              {stats?.codebaseCoverage.percentage ?? 0}%
            </div>
            <div className="kpi-progress-bg">
              <div 
                className="kpi-progress-fill" 
                style={{ 
                  width: `${stats?.codebaseCoverage.percentage ?? 0}%`, 
                  backgroundColor: 'var(--color-codemap)' 
                }} 
              />
            </div>
          </div>
          <div className="kpi-footer">
            <span>{stats?.codebaseCoverage.coveredCodemaps ?? 0} of {stats?.codebaseCoverage.totalCodemaps ?? 0} source files mapped</span>
          </div>
        </div>
      </div>

      {/* Defensive vs Structural Knowledge Bar */}
      <div className="dashboard-section-card defensive-bar-card">
        <div className="section-card-header">
          <div className="section-title-group">
            <Brain size={18} style={{ color: 'var(--accent-color)' }} />
            <h3>Defensive vs. Structural Knowledge Ratio</h3>
          </div>
          <div className="ratio-legend">
            <span className="legend-item"><span className="dot defensive" /> Defensive ({defensiveCount}): Invariants, Lessons & Warnings</span>
            <span className="legend-item"><span className="dot structural" /> Structural ({structuralCount}): Facts, Concepts & Guides</span>
          </div>
        </div>
        <div className="ratio-bar-container">
          <div className="ratio-bar-fill defensive" style={{ width: `${defensivePct}%` }}>
            {defensivePct > 10 && <span>{defensivePct}% Defensive</span>}
          </div>
          <div className="ratio-bar-fill structural" style={{ width: `${100 - defensivePct}%` }}>
            {(100 - defensivePct) > 10 && <span>{100 - defensivePct}% Structural</span>}
          </div>
        </div>
      </div>

      {/* Middle Grid: Knowledge Hotspots & Consolidation Center */}
      <div className="dashboard-columns-grid">
        {/* Knowledge Hotspots */}
        <div className="dashboard-section-card">
          <div className="section-card-header">
            <div className="section-title-group">
              <FileCode size={18} style={{ color: 'var(--color-codemap)' }} />
              <h3>Top Knowledge Hotspots</h3>
            </div>
            <span className="section-tag">Most Invariant-Rich</span>
          </div>
          
          <div className="section-card-body">
            {(!stats?.hotspots || stats.hotspots.length === 0) ? (
              <div className="empty-state-card">
                <FileCode size={24} style={{ color: 'var(--text-muted)' }} />
                <p>No mapped source file hotspots found in this workspace context.</p>
              </div>
            ) : (
              <div className="hotspots-list">
                {stats.hotspots.map((h, idx) => {
                  const filename = h.title || h.id.replace(/^file_/, '').replace(/_/g, '/');
                  return (
                    <div key={h.id} className="hotspot-item">
                      <div className="hotspot-rank">#{idx + 1}</div>
                      <div className="hotspot-details">
                        <div className="hotspot-title">{filename}</div>
                        <div className="hotspot-subtitle">{h.attached_count} attached invariant & caller constraints</div>
                      </div>
                      <button 
                        className="hotspot-action-btn"
                        onClick={() => window.location.hash = 'graph'}
                        title="View file neighborhood in Graph View"
                      >
                        <span>Graph</span>
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Consolidation Action Center */}
        <div className="dashboard-section-card">
          <div className="section-card-header">
            <div className="section-title-group">
              <Zap size={18} style={{ color: 'var(--color-guide)' }} />
              <h3>Consolidation Action Center</h3>
            </div>
            <span className="section-tag">Synthesis Backlog</span>
          </div>

          <div className="section-card-body">
            {(!stats?.backlog.candidates || stats.backlog.candidates.length === 0) ? (
              <div className="empty-state-card">
                <CheckCircle2 size={24} style={{ color: 'var(--color-fact)' }} />
                <p>All micro-memories are consolidated. No pending architectural debt!</p>
              </div>
            ) : (
              <div className="consolidation-list">
                {stats.backlog.candidates.map(candidate => (
                  <div key={candidate.target} className="consolidation-item">
                    <div className="consolidation-details">
                      <div className="consolidation-target">{candidate.targetTitle || candidate.target}</div>
                      <div className="consolidation-meta">
                        <span className="badge badge-guide">{candidate.memoryCount} micro-memories</span>
                        <span className="consolidation-snippets">
                          {candidate.memories.slice(0, 2).map(m => m.title).join(', ')}...
                        </span>
                      </div>
                    </div>
                    <button 
                      className="consolidate-btn"
                      disabled={consolidatingFile === candidate.target}
                      onClick={() => handleConsolidate(candidate.target)}
                    >
                      {consolidatingFile === candidate.target ? 'Synthesizing...' : 'Consolidate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Grid: Decay Watchlist & Recent Activity */}
      <div className="dashboard-columns-grid">
        {/* At-Risk Decaying Memories Watchlist */}
        <div className="dashboard-section-card">
          <div className="section-card-header">
            <div className="section-title-group">
              <ShieldAlert size={18} style={{ color: 'var(--color-warning)' }} />
              <h3>At-Risk Confidence Watchlist</h3>
            </div>
            <span className="section-tag warning">Fading Context</span>
          </div>

          <div className="section-card-body">
            {(!stats?.decayWatchlist || stats.decayWatchlist.length === 0) ? (
              <div className="empty-state-card">
                <ShieldCheck size={24} style={{ color: 'var(--color-fact)' }} />
                <p>All active memories are operating at optimal confidence (&ge;90%).</p>
              </div>
            ) : (
              <div className="decay-list">
                {stats.decayWatchlist.map(item => {
                  const confPct = Math.round((item.confidence || 0) * 100);
                  return (
                    <div key={item.id} className="decay-item">
                      <span className={`badge badge-${item.type}`}>{item.type}</span>
                      <div className="decay-details">
                        <div className="decay-title">{item.title}</div>
                        <div className="decay-progress-row">
                          <div className="decay-progress-bg">
                            <div 
                              className="decay-progress-fill" 
                              style={{ 
                                width: `${confPct}%`,
                                backgroundColor: getHealthColor(confPct)
                              }} 
                            />
                          </div>
                          <span className="decay-conf-pct" style={{ color: getHealthColor(confPct) }}>
                            {confPct}%
                          </span>
                        </div>
                      </div>
                      <span className="decay-time">{formatTimeAgo(item.updated)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Memory Activity Timeline */}
        <div className="dashboard-section-card">
          <div className="section-card-header">
            <div className="section-title-group">
              <Clock size={18} style={{ color: 'var(--accent-hover)' }} />
              <h3>Recent Memory Activity</h3>
            </div>
            <span className="section-tag">Live Feed</span>
          </div>

          <div className="section-card-body">
            {(!stats?.recentActivity || stats.recentActivity.length === 0) ? (
              <div className="empty-state-card">
                <Activity size={24} style={{ color: 'var(--text-muted)' }} />
                <p>No recent activity recorded in this workspace context.</p>
              </div>
            ) : (
              <div className="timeline-list">
                {stats.recentActivity.map(act => (
                  <div key={act.id} className="timeline-item">
                    <div className="timeline-bullet" />
                    <div className="timeline-content">
                      <div className="timeline-header-row">
                        <span className={`badge badge-${act.type}`}>{act.type}</span>
                        <span className="timeline-title">{act.title}</span>
                      </div>
                      <div className="timeline-meta-row">
                        <span className="timeline-source">Source: {act.source || 'manual'}</span>
                        <span className="timeline-time">{formatTimeAgo(act.updated || act.created)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
