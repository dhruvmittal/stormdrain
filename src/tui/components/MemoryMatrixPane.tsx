import React, { useState } from 'react';
import { useInk } from '../inkContext';
import { Memory } from '../../types';
import { renderConfidenceBar } from './OverviewPane';
import { getFixedWindow } from '../utils';

interface MemoryMatrixPaneProps {
  memories: Memory[];
  onSelectMemory?: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  height?: number;
  width?: number;
}

export const MemoryMatrixPane: React.FC<MemoryMatrixPaneProps> = ({
  memories,
  onSelectMemory,
  searchQuery,
  onSearchChange,
  height,
  width
}) => {
  const { Box, Text, useInput } = useInk();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  useInput((input, key) => {
    if (isSearching) {
      if (key.return || key.escape) {
        setIsSearching(false);
        return;
      }
      if (key.backspace || key.delete) {
        onSearchChange(searchQuery.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        onSearchChange(searchQuery + input);
        return;
      }
      return;
    }

    if (input === '/') {
      setIsSearching(true);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, memories.length - 1));
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }
    if (key.return && onSelectMemory && memories[selectedIndex]) {
      onSelectMemory(memories[selectedIndex].metadata.id);
    }
  });

  const matrixWindowSize = Math.max(5, (height || 16) - 6);

  const selectedMem = memories[selectedIndex] || null;
  const { windowItems, startIndex, padCount } = getFixedWindow(memories, selectedIndex, matrixWindowSize);

  return (
    <Box flexDirection="column" gap={1} paddingY={1} width={width} height={height}>
      {/* Search Header */}
      <Box borderStyle="single" borderColor="blue" paddingX={1} justifyContent="space-between">
        <Text>
          🔍 Search Filter: <Text bold color={isSearching ? 'green' : 'white'}>{searchQuery || '(all memories)'}</Text>
          {isSearching && <Text color="green"> [TYPING... press Enter to lock]</Text>}
        </Text>
        <Text color="gray">Press [/] to Search | [↑/↓] Navigate</Text>
      </Box>

      <Box gap={2}>
        {/* Table Column */}
        <Box flexDirection="column" width="55%" borderStyle="round" borderColor="gray" paddingX={1}>
          <Box justifyContent="space-between" borderStyle="single" borderColor="gray">
            <Text bold color="cyan">TYPE / TITLE</Text>
            <Text bold color="cyan">CONFIDENCE</Text>
          </Box>

          <Box flexDirection="column" height={matrixWindowSize}>
            {memories.length === 0 ? (
              <Text color="yellow">No memories match search criteria.</Text>
            ) : (
              windowItems.map((mem, idx) => {
                const globalIdx = startIndex + idx;
                const isSelected = globalIdx === selectedIndex;
                const confBar = renderConfidenceBar(mem.metadata.confidence, 8);

                let typeColor = 'cyan';
                if (mem.metadata.type === 'pattern') typeColor = 'green';
                if (mem.metadata.type === 'warning') typeColor = 'red';
                if (mem.metadata.type === 'guide') typeColor = 'magenta';
                if (mem.metadata.type === 'lesson') typeColor = 'yellow';

                return (
                  <Box key={mem.metadata.id} justifyContent="space-between">
                    <Text
                      backgroundColor={isSelected ? 'cyan' : undefined}
                      color={isSelected ? 'black' : typeColor}
                      bold={isSelected}
                    >
                      {`[${mem.metadata.type.toUpperCase().substring(0, 3)}] ${mem.metadata.title.substring(0, 24)}`}
                    </Text>
                    <Text color="yellow">
                      [{confBar}] {(mem.metadata.confidence * 100).toFixed(0)}%
                    </Text>
                  </Box>
                );
              })
            )}
            {Array.from({ length: padCount }).map((_, i) => (
              <Box key={`pad-${i}`}>
                <Text> </Text>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Selected Memory Inspector Pane */}
        <Box flexDirection="column" width="45%" borderStyle="round" borderColor="magenta" paddingX={1} height={matrixWindowSize + 3}>
          <Text bold color="magenta">📝 MEMORY DETAIL PREVIEW</Text>
          {selectedMem ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="white">{selectedMem.metadata.title.substring(0, 32)}</Text>
              <Text color="gray">ID: {selectedMem.metadata.id}</Text>
              <Text color="gray">Tags: {selectedMem.metadata.tags.slice(0, 3).map(t => `#${t}`).join(' ')}</Text>
              <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={Math.max(2, matrixWindowSize - 4)}>
                <Text color="white">
                  {selectedMem.content.substring(0, 240)}
                  {selectedMem.content.length > 240 ? '...' : ''}
                </Text>
              </Box>
            </Box>
          ) : (
            <Text color="gray">Select a memory to view preview.</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};
