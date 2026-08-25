import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useInk } from './inkContext';
import { ViewTab, ContextMetrics, LogEntry, TreeFolderNode } from './types';
import { TuiDataFetcher } from './data';
import { Header } from './components/Header';
import { OverviewPane } from './components/OverviewPane';
import { MemoryMatrixPane } from './components/MemoryMatrixPane';
import { DagTreePane } from './components/DagTreePane';
import { RelationalPane } from './components/RelationalPane';
import { CurationPane } from './components/CurationPane';
import { Footer } from './components/Footer';
import { Memory, ConsolidationCandidate, FullNodeDetails } from '../types';
import { ContextManager } from '../core/context';

interface AppProps {
  contextName: string;
  dataFetcher?: TuiDataFetcher;
}

export const App: React.FC<AppProps> = ({ contextName, dataFetcher }) => {
  const { Box, useApp, useInput } = useInk();
  const { exit } = useApp();
  const fetcher = useMemo(() => dataFetcher || new TuiDataFetcher(), [dataFetcher]);

  const [activeTab, setActiveTab] = useState<ViewTab>('overview');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [statusMsg, setStatusMsg] = useState<string>('Welcome to StormDrain Monitor.');

  const [metrics, setMetrics] = useState<ContextMetrics | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tree, setTree] = useState<TreeFolderNode | null>(null);
  const [candidates, setCandidates] = useState<ConsolidationCandidate[]>([]);
  const [selectedNodeDetails, setSelectedNodeDetails] = useState<FullNodeDetails | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: new Date().toLocaleTimeString(), level: 'info', message: `Initialized TUI monitor bound to context "${contextName}".` }
  ]);

  const [dimensions, setDimensions] = useState({
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        rows: process.stdout.rows || 24,
        cols: process.stdout.columns || 80
      });
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  const termWidth = Math.max(40, dimensions.cols - 2);
  const termHeight = Math.max(16, dimensions.rows - 2);
  // Header (~5 rows) + Footer (~3 rows) = ~8 rows reserved for fixed UI frames
  const contentHeight = Math.max(8, termHeight - 8);

  const refreshData = useCallback(() => {
    try {
      const m = fetcher.getContextMetrics(contextName);
      setMetrics(m);

      const mems = fetcher.getMemories(contextName, searchQuery);
      setMemories(mems);

      const t = fetcher.getFileTree(contextName);
      setTree(t);

      const c = fetcher.getCandidates(contextName);
      setCandidates(c);

      if (selectedNodeId) {
        const details = fetcher.getNodeDetails(contextName, selectedNodeId);
        setSelectedNodeDetails(details);
      }
    } catch (e: any) {
      setStatusMsg(`Fetch error: ${e.message}`);
    }
  }, [contextName, fetcher, searchQuery, selectedNodeId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      refreshData();
    }, 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshData]);

  const handleConsolidate = (target: string) => {
    try {
      const ctx = new ContextManager(contextName);
      const res = ctx.consolidateNeighborhood(target);
      ctx.close();
      if (res.consolidatedId) {
        setStatusMsg(`Consolidated ${res.mergedCount} micro-memories into super-memory ${res.consolidatedId} for "${target}".`);
        setLogs(prev => [...prev, {
          timestamp: new Date().toLocaleTimeString(),
          level: 'sync',
          message: `Consolidated target "${target}" -> ${res.consolidatedId}`
        }]);
      } else {
        setStatusMsg(`No micro-memories to consolidate for target "${target}".`);
      }
      refreshData();
    } catch (e: any) {
      setStatusMsg(`Consolidation error: ${e.message}`);
    }
  };

  useInput((input, key) => {
    if (input === '1') setActiveTab('overview');
    if (input === '2') setActiveTab('matrix');
    if (input === '3') setActiveTab('tree');
    if (input === '4') setActiveTab('relational');
    if (input === '5') setActiveTab('curate');
    if (input === 'p' || input === 'P') setAutoRefresh(prev => !prev);
    if (input === 'q' || input === 'Q') exit();
  });

  return (
    <Box flexDirection="column" paddingX={1} width={termWidth} height={termHeight}>
      <Header metrics={metrics} activeTab={activeTab} autoRefresh={autoRefresh} width={termWidth} />

      <Box flexDirection="column" height={contentHeight} width={termWidth}>
        {activeTab === 'overview' && <OverviewPane metrics={metrics} logs={logs} height={contentHeight} width={termWidth} />}

        {activeTab === 'matrix' && (
          <MemoryMatrixPane
            memories={memories}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectMemory={(id) => {
              setSelectedNodeId(id);
              setActiveTab('relational');
            }}
            height={contentHeight}
            width={termWidth}
          />
        )}

        {activeTab === 'tree' && (
          <DagTreePane
            tree={tree}
            onSelectFile={(filePath) => {
              setSelectedNodeId(filePath);
              setActiveTab('relational');
            }}
            height={contentHeight}
            width={termWidth}
          />
        )}

        {activeTab === 'relational' && (
          <RelationalPane details={selectedNodeDetails} selectedId={selectedNodeId} height={contentHeight} width={termWidth} />
        )}

        {activeTab === 'curate' && (
          <CurationPane candidates={candidates} onConsolidate={handleConsolidate} height={contentHeight} width={termWidth} />
        )}
      </Box>

      <Footer statusMessage={statusMsg} width={termWidth} />
    </Box>
  );
};
