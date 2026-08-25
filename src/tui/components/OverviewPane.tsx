import React from 'react';
import { useInk } from '../inkContext';
import { ContextMetrics, LogEntry } from '../types';

interface OverviewPaneProps {
  metrics: ContextMetrics | null;
  logs: LogEntry[];
  height?: number;
  width?: number;
}

export function renderConfidenceBar(confidence: number, width: number = 10): string {
  const filledLength = Math.round(confidence * width);
  const emptyLength = width - filledLength;
  return '█'.repeat(filledLength) + '░'.repeat(emptyLength);
}

export const OverviewPane: React.FC<OverviewPaneProps> = ({ metrics, logs, height, width }) => {
  const { Box, Text } = useInk();

  if (!metrics) {
    return (
      <Box padding={1} height={height}>
        <Text color="yellow">Loading context telemetry...</Text>
      </Box>
    );
  }

  const logWindowSize = Math.max(3, (height || 16) - 10);

  const confBar = renderConfidenceBar(metrics.avgConfidence, 15);
  const healthStatus = metrics.decayedMemoriesCount === 0 ? 'HEALTHY' : `${metrics.decayedMemoriesCount} DECAYED`;
  const healthColor = metrics.decayedMemoriesCount === 0 ? 'green' : 'yellow';

  const visibleLogs = logs.slice(-logWindowSize);
  const padLogs = logWindowSize - visibleLogs.length;

  return (
    <Box flexDirection="column" gap={1} paddingY={1} width={width} height={height}>
      {/* Metrics Row */}
      <Box gap={3}>
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} width="50%" height={7}>
          <Text bold color="blue">📊 CONTEXT METRICS</Text>
          <Text>Total Memories: <Text bold color="white">{metrics.totalMemories}</Text></Text>
          <Text>Codemap Vertices: <Text bold color="white">{metrics.codemapVertices}</Text></Text>
          <Text>Candidates: <Text bold color={metrics.consolidationCandidatesCount > 0 ? 'magenta' : 'gray'}>{metrics.consolidationCandidatesCount} 🎯</Text></Text>
          <Text color="gray">Path: {metrics.boundPaths[0]?.substring(0, 24) || 'none'}</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} width="50%" height={7}>
          <Text bold color="green">⚡ SYSTEM HEALTH & DECAY</Text>
          <Text>Status: <Text bold color={healthColor}>{healthStatus}</Text></Text>
          <Text>Avg Conf: <Text bold color="cyan">{(metrics.avgConfidence * 100).toFixed(0)}%</Text></Text>
          <Text color="cyan">[{confBar}]</Text>
        </Box>
      </Box>

      {/* Live Telemetry Stream */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} height={logWindowSize + 2}>
        <Text bold color="yellow">📜 LIVE AGENT & DISK TELEMETRY LOGS</Text>
        {visibleLogs.map((log, index) => {
          let color = 'white';
          if (log.level === 'warn') color = 'yellow';
          if (log.level === 'decay') color = 'red';
          if (log.level === 'sync') color = 'green';
          if (log.level === 'mcp') color = 'cyan';

          return (
            <Box key={index} justifyContent="space-between">
              <Text color="gray">[{log.timestamp}]</Text>
              <Text color={color}>{log.message.substring(0, (width || 100) - 20)}</Text>
            </Box>
          );
        })}
        {Array.from({ length: padLogs }).map((_, i) => (
          <Box key={`pad-log-${i}`}>
            <Text> </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
