import React, { useState } from 'react';
import { useInk } from '../inkContext';
import { ConsolidationCandidate } from '../../types';
import { getFixedWindow } from '../utils';

interface CurationPaneProps {
  candidates: ConsolidationCandidate[];
  onConsolidate: (target: string) => void;
  height?: number;
  width?: number;
}

export const CurationPane: React.FC<CurationPaneProps> = ({ candidates, onConsolidate, height, width }) => {
  const { Box, Text, useInput } = useInk();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useInput((input, key) => {
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, candidates.length - 1));
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }
    if ((input === 'c' || input === 'C' || key.return) && candidates[selectedIndex]) {
      onConsolidate(candidates[selectedIndex].target);
    }
  });

  const curateWindowSize = Math.max(4, (height || 16) - 5);

  const selectedCand = candidates[selectedIndex] || null;
  const { windowItems: windowCand, startIndex, padCount: padCand } = getFixedWindow(candidates, selectedIndex, curateWindowSize);

  const attachedMems = selectedCand ? selectedCand.memories.slice(0, curateWindowSize) : [];
  const padMems = curateWindowSize - attachedMems.length;

  return (
    <Box flexDirection="column" gap={1} paddingY={1} width={width} height={height}>
      <Box borderStyle="single" borderColor="magenta" paddingX={1} justifyContent="space-between">
        <Text bold color="magenta">🎯 CONSOLIDATION & CURATION HUB</Text>
        <Text color="gray">Candidates: {candidates.length} | Press [C] or Enter to Consolidate Target</Text>
      </Box>

      {candidates.length === 0 ? (
        <Box padding={1} borderStyle="round" borderColor="green" height={curateWindowSize + 2}>
          <Text color="green">
            ✨ Graph Knowledge is Pristine! No micro-memory clusters (≥3) require consolidation at this time.
          </Text>
        </Box>
      ) : (
        <Box gap={2}>
          {/* Candidates List */}
          <Box flexDirection="column" width="50%" borderStyle="round" borderColor="magenta" paddingX={1} height={curateWindowSize + 2}>
            <Text bold color="white">Targets Ready for Synthesis:</Text>
            {windowCand.map((cand, idx) => {
              const globalIdx = startIndex + idx;
              const isSelected = globalIdx === selectedIndex;
              return (
                <Box key={cand.target} justifyContent="space-between">
                  <Text
                    backgroundColor={isSelected ? 'magenta' : undefined}
                    color={isSelected ? 'white' : 'cyan'}
                    bold={isSelected}
                  >
                    {`🎯 ${cand.targetTitle.substring(0, 26)}`}
                  </Text>
                  <Text color="yellow">({cand.memoryCount})</Text>
                </Box>
              );
            })}
            {Array.from({ length: padCand }).map((_, i) => (
              <Box key={`pad-c-${i}`}>
                <Text> </Text>
              </Box>
            ))}
          </Box>

          {/* Attached Micro-Memories Preview */}
          <Box flexDirection="column" width="50%" borderStyle="round" borderColor="yellow" paddingX={1} height={curateWindowSize + 2}>
            <Text bold color="yellow"> Attached Micro-Memories:</Text>
            {selectedCand ? (
              <>
                {attachedMems.map((mem) => (
                  <Box key={mem.id} justifyContent="space-between">
                    <Text color="white">
                      - [{mem.type.toUpperCase().substring(0, 3)}] {mem.title.substring(0, 22)}
                    </Text>
                    <Text color="gray">{(mem.confidence * 100).toFixed(0)}%</Text>
                  </Box>
                ))}
                {Array.from({ length: padMems }).map((_, i) => (
                  <Box key={`pad-m-${i}`}>
                    <Text> </Text>
                  </Box>
                ))}
              </>
            ) : (
              <Text color="gray">Select candidate target on the left.</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};
