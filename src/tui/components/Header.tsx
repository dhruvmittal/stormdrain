import React from 'react';
import { useInk } from '../inkContext';
import { ViewTab, ContextMetrics } from '../types';

interface HeaderProps {
  metrics: ContextMetrics | null;
  activeTab: ViewTab;
  autoRefresh: boolean;
  width?: number;
}

export const Header: React.FC<HeaderProps> = ({ metrics, activeTab, autoRefresh, width }) => {
  const { Box, Text } = useInk();

  const tabs: Array<{ key: ViewTab; label: string; shortcut: string }> = [
    { key: 'overview', label: 'Overview', shortcut: '1' },
    { key: 'matrix', label: 'Memories', shortcut: '2' },
    { key: 'tree', label: 'DAG Tree', shortcut: '3' },
    { key: 'relational', label: 'Relations', shortcut: '4' },
    { key: 'curate', label: 'Curate', shortcut: '5' }
  ];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} width={width}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          ⛈️  STORM DRAIN TUI v1.0
        </Text>
        <Text>
          Context: <Text bold color="green">{metrics?.contextName || 'default'}</Text>
          {' | '}
          Auto-Refresh: <Text color={autoRefresh ? 'green' : 'yellow'}>{autoRefresh ? '1s ON' : 'PAUSED'}</Text>
        </Text>
      </Box>

      <Box marginTop={1} gap={2}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Text
              key={tab.key}
              bold={isActive}
              color={isActive ? 'black' : 'gray'}
              backgroundColor={isActive ? 'cyan' : undefined}
            >
              {` [${tab.shortcut}] ${tab.label} `}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
};
