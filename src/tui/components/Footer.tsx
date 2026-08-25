import React from 'react';
import { useInk } from '../inkContext';

interface FooterProps {
  statusMessage?: string;
  width?: number;
}

export const Footer: React.FC<FooterProps> = ({ statusMessage, width }) => {
  const { Box, Text } = useInk();

  return (
    <Box flexDirection="column" width={width}>
      {statusMessage && (
        <Box backgroundColor="blue" paddingX={1}>
          <Text bold color="white">📢 {statusMessage.substring(0, (width || 100) - 6)}</Text>
        </Box>
      )}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text color="cyan">
          Keybindings: <Text bold color="white">[1-5]</Text> Switch Tabs | <Text bold color="white">[/]</Text> Search | <Text bold color="white">[P]</Text> Toggle Refresh | <Text bold color="white">[Q]</Text> Quit
        </Text>
        <Text color="gray">StormDrain Remote TUI</Text>
      </Box>
    </Box>
  );
};
