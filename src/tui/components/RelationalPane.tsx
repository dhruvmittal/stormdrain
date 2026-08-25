import React from 'react';
import { useInk } from '../inkContext';
import { FullNodeDetails } from '../../types';

interface RelationalPaneProps {
  details: FullNodeDetails | null;
  selectedId: string;
  height?: number;
  width?: number;
}

export const RelationalPane: React.FC<RelationalPaneProps> = ({ details, selectedId, height, width }) => {
  const { Box, Text } = useInk();

  const relationalWindowSize = Math.max(4, (height || 16) - 7);

  if (!details) {
    return (
      <Box padding={1} flexDirection="column" height={height} width={width}>
        <Text color="yellow">No node selected for relational inspection.</Text>
        <Text color="gray">Enter node ID or file path to view topological links (e.g. mem_123456 or src/core/context.ts).</Text>
      </Box>
    );
  }

  const outgoing = details.outgoingRelations.slice(0, relationalWindowSize);
  const padOut = relationalWindowSize - outgoing.length;

  const incoming = details.incomingRelations.slice(0, relationalWindowSize);
  const padIn = relationalWindowSize - incoming.length;

  return (
    <Box flexDirection="column" gap={1} paddingY={1} width={width} height={height}>
      <Box borderStyle="single" borderColor="magenta" paddingX={1} justifyContent="space-between">
        <Text bold color="magenta">
          🔗 RELATIONAL NEIGHBORHOOD MAP: <Text color="white">[{details.nodeType.toUpperCase()}] {details.title.substring(0, 28)}</Text>
        </Text>
        <Text color="gray">ID: {details.id}</Text>
      </Box>

      <Box gap={2}>
        {/* Outgoing Connections */}
        <Box flexDirection="column" width="50%" borderStyle="round" borderColor="cyan" paddingX={1} height={relationalWindowSize + 2}>
          <Text bold color="cyan">📤 Outgoing Relations ({details.outgoingRelations.length})</Text>
          {outgoing.map((rel, idx) => (
            <Text key={idx} color="white">
              -- <Text color="yellow">({rel.type.substring(0, 6)})</Text> --&gt; <Text bold color="cyan">{rel.title.substring(0, 18)}</Text>
            </Text>
          ))}
          {Array.from({ length: padOut }).map((_, i) => (
            <Box key={`pad-out-${i}`}>
              <Text> </Text>
            </Box>
          ))}
        </Box>

        {/* Incoming Connections */}
        <Box flexDirection="column" width="50%" borderStyle="round" borderColor="green" paddingX={1} height={relationalWindowSize + 2}>
          <Text bold color="green">📥 Incoming Relations ({details.incomingRelations.length})</Text>
          {incoming.map((rel, idx) => (
            <Text key={idx} color="white">
              &lt;-- <Text color="yellow">({rel.type.substring(0, 6)})</Text> -- <Text bold color="green">{rel.title.substring(0, 18)}</Text>
            </Text>
          ))}
          {Array.from({ length: padIn }).map((_, i) => (
            <Box key={`pad-in-${i}`}>
              <Text> </Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* AST Symbol Outline if codemap */}
      {details.astOutline && details.astOutline.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} height={3}>
          <Text bold color="yellow">🌲 AST EXPORTED SYMBOL OUTLINE</Text>
          <Box flexWrap="wrap" gap={1}>
            {details.astOutline.slice(0, 8).map((sym, idx) => (
              <Text key={idx} color="white" backgroundColor="blue">
                {` ${sym} `}
              </Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};
