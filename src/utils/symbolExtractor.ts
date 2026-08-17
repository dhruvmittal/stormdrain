import { getParserForFile } from './parsers';

export function extractSymbolOutline(filePath: string, content: string): string[] {
  const parser = getParserForFile(filePath);
  return parser.extractSymbols(filePath, content);
}
