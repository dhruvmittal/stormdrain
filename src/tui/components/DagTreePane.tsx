import React, { useState } from 'react';
import { useInk } from '../inkContext';
import { TreeFolderNode } from '../types';
import { getFixedWindow } from '../utils';

interface DagTreePaneProps {
  tree: TreeFolderNode | null;
  onSelectFile?: (filePath: string) => void;
  height?: number;
  width?: number;
}

interface FlattenedItem {
  id: string;
  type: 'folder' | 'file' | 'memory';
  label: string;
  depth: number;
  confidence?: number;
  memType?: string;
  filePath?: string;
}

export function flattenTree(
  folder: TreeFolderNode,
  depth: number = 0,
  prefix: string = ''
): FlattenedItem[] {
  const items: FlattenedItem[] = [];

  const folderKeys = Object.keys(folder.subfolders).sort();
  for (const key of folderKeys) {
    const sub = folder.subfolders[key];
    items.push({
      id: `dir_${sub.path}`,
      type: 'folder',
      label: `📁 ${sub.name}/`,
      depth
    });
    items.push(...flattenTree(sub, depth + 1));
  }

  for (const file of folder.files) {
    const fileName = file.relativePath.split('/').pop() || file.relativePath;
    items.push({
      id: file.id,
      type: 'file',
      label: `📄 ${fileName}`,
      depth,
      filePath: file.relativePath
    });

    for (const mem of file.attachedMemories) {
      items.push({
        id: mem.id,
        type: 'memory',
        label: `🧠 [${mem.type.toUpperCase()}] ${mem.title}`,
        depth: depth + 1,
        confidence: mem.confidence,
        memType: mem.type
      });
    }
  }

  return items;
}

export const DagTreePane: React.FC<DagTreePaneProps> = ({ tree, onSelectFile, height, width }) => {
  const { Box, Text, useInput } = useInk();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  if (!tree) {
    return (
      <Box padding={1}>
        <Text color="yellow">Loading file DAG skeleton...</Text>
      </Box>
    );
  }

  const items = flattenTree(tree);

  useInput((input, key) => {
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }
    if (key.return && onSelectFile) {
      const selected = items[selectedIndex];
      if (selected && selected.filePath) {
        onSelectFile(selected.filePath);
      }
    }
  });

  const treeWindowSize = Math.max(5, (height || 16) - 4);
  const { windowItems, startIndex, padCount } = getFixedWindow(items, selectedIndex, treeWindowSize);

  return (
    <Box flexDirection="column" paddingY={1} width={width} height={height}>
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">🌲 TOPOLOGICAL CODEBASE FILE DAG TREE</Text>
        <Text color="gray">
          Items: {items.length} | [{startIndex + 1}-{startIndex + windowItems.length}/{items.length}]
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} height={treeWindowSize}>
        {items.length === 0 ? (
          <Text color="gray">No file vertices indexed yet in DAG. Run stormdrain graph scan.</Text>
        ) : (
          windowItems.map((item, idx) => {
            const globalIndex = startIndex + idx;
            const isSelected = globalIndex === selectedIndex;
            const indent = '  '.repeat(item.depth);
            const connector = item.depth > 0 ? '├── ' : '';

            let color = 'white';
            if (item.type === 'folder') color = 'blue';
            if (item.type === 'file') color = 'cyan';
            if (item.type === 'memory') color = 'magenta';

            return (
              <Box key={item.id + globalIndex}>
                <Text
                  backgroundColor={isSelected ? 'cyan' : undefined}
                  color={isSelected ? 'black' : color}
                  bold={isSelected}
                >
                  {` ${indent}${connector}${item.label} `}
                </Text>
                {item.confidence !== undefined && (
                  <Text color="yellow"> (conf: {item.confidence})</Text>
                )}
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
  );
};
