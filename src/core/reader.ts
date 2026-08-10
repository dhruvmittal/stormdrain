import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigManager } from './config';
import { ContextManager } from './context';
import { MultiHopMemoryResult } from '../types';

export interface ReadOptions {
  filePath: string;
  startLine?: number;
  endLine?: number;
  includeInvariants?: boolean;
  includeSymbols?: boolean;
  context?: string;
  cwd?: string;
}

export interface ReadResult {
  content: string;
  rawContent: string;
  filePath: string;
  relativePath: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  invariantsCount: number;
  invariantsInjected: boolean;
  cached: boolean;
  symbols: string[];
}

interface SessionReadEntry {
  hash: string;
  timestamp: number;
}

export class FileReader {
  private configManager: ConfigManager;
  private sessionReads: Map<string, SessionReadEntry> = new Map();

  constructor(configManager?: ConfigManager) {
    this.configManager = configManager || new ConfigManager();
  }

  public clearSessionCache(): void {
    this.sessionReads.clear();
  }

  public async readFile(options: ReadOptions): Promise<ReadResult> {
    const cwd = options.cwd || process.cwd();
    const resolvedPath = path.isAbsolute(options.filePath) 
      ? path.normalize(options.filePath) 
      : path.normalize(path.resolve(cwd, options.filePath));

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${options.filePath} (resolved: ${resolvedPath})`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${options.filePath}`);
    }

    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    const allLines = fileContent.split(/\r?\n/);
    const totalLines = allLines.length;

    // Line slicing (1-indexed)
    let startLine = options.startLine && options.startLine > 0 ? options.startLine : 1;
    let endLine = options.endLine && options.endLine > 0 ? options.endLine : totalLines;

    if (startLine > totalLines) {
      startLine = totalLines > 0 ? totalLines : 1;
    }
    if (endLine > totalLines) {
      endLine = totalLines;
    }
    if (endLine < startLine) {
      endLine = startLine;
    }

    const slicedLines = allLines.slice(startLine - 1, endLine);
    const rawContent = slicedLines.join('\n');

    // Format line-numbered source
    const lineNumPad = String(endLine).length;
    const numberedLines = slicedLines.map((line, idx) => {
      const currentLineNum = startLine + idx;
      const paddedNum = String(currentLineNum).padStart(lineNumPad, ' ');
      return `${paddedNum}: ${line}`;
    });

    const settings = this.configManager.getSettings();
    const targetCtx = options.context || this.configManager.resolveContext(undefined, cwd);
    
    // Resolve relative path against context bound paths or cwd
    let relativePath = path.relative(cwd, resolvedPath);
    const ctxConfig = this.configManager.getContext(targetCtx);
    if (ctxConfig && ctxConfig.paths && ctxConfig.paths.length > 0) {
      for (const root of ctxConfig.paths) {
        const rel = path.relative(root, resolvedPath);
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          relativePath = rel;
          break;
        }
      }
    }
    if (!relativePath || relativePath.startsWith('..')) {
      relativePath = path.basename(resolvedPath);
    }

    const sessionKey = `${targetCtx}:${resolvedPath}`;

    // Symbol extraction
    const shouldExtractSymbols = options.includeSymbols !== undefined 
      ? options.includeSymbols 
      : settings.readTool.includeSymbols;
    
    const symbols = shouldExtractSymbols ? this.extractSymbolOutline(resolvedPath, fileContent) : [];

    // Check invariant injection eligibility
    const toolEnabled = settings.readTool.enabled;
    const mode = settings.readTool.mode;
    const includeInvariants = options.includeInvariants !== false && toolEnabled && mode !== 'disabled';

    let invariantsHeader = '';
    let invariantsCount = 0;
    let invariantsInjected = false;
    let isCached = false;

    if (includeInvariants) {
      const cachePolicy = settings.readTool.cachePolicy;
      const cachedEntry = this.sessionReads.get(sessionKey);

      if (cachePolicy === 'first_read_only' && cachedEntry) {
        isCached = true;
        invariantsHeader = `> [StormDrain: Topological invariants cached for this session. Use sd_recall(target_file="${relativePath}") to inspect full knowledge subgraph]\n\n`;
      } else if (cachePolicy === 'on_file_changed' && cachedEntry && cachedEntry.hash === fileHash) {
        isCached = true;
        invariantsHeader = `> [StormDrain: Topological invariants cached (file unchanged). Use sd_recall(target_file="${relativePath}") to inspect full knowledge subgraph]\n\n`;
      } else {
        // Fetch memories via ContextManager
        const ctx = new ContextManager(targetCtx);
        try {
          // Check relative path for DAG lookup, with fallbacks to options.filePath and basename
          let graphResults = ctx.recallGraph(relativePath, settings.readTool.maxHops);
          if (graphResults.length === 0 && options.filePath !== relativePath) {
            const fallback = ctx.recallGraph(options.filePath, settings.readTool.maxHops);
            if (fallback.length > 0) {
              graphResults = fallback;
            } else {
              const baseNameRes = ctx.recallGraph(path.basename(resolvedPath), settings.readTool.maxHops);
              if (baseNameRes.length > 0) {
                graphResults = baseNameRes;
              }
            }
          }

          invariantsCount = graphResults.length;

          if (graphResults.length > 0) {
            invariantsInjected = true;
            invariantsHeader = this.formatInvariantHeader(
              relativePath,
              graphResults as MultiHopMemoryResult[],
              settings.readTool.tokenBudget
            );
          }
          this.sessionReads.set(sessionKey, { hash: fileHash, timestamp: Date.now() });
        } finally {
          await ctx.close();
        }
      }
    }


    // Build complete formatted output
    const sections: string[] = [];

    if (invariantsHeader) {
      sections.push(invariantsHeader.trim());
    }

    if (symbols.length > 0) {
      sections.push(`### AST Symbol Outline (${relativePath}) ###\n${symbols.map(s => `- ${s}`).join('\n')}`);
    }

    const header = `### File: ${relativePath} (Lines ${startLine} - ${endLine} of ${totalLines}) ###`;
    const sourceBlock = `${header}\n${numberedLines.join('\n')}`;
    sections.push(sourceBlock);

    return {
      content: sections.join('\n\n'),
      rawContent,
      filePath: resolvedPath,
      relativePath,
      totalLines,
      startLine,
      endLine,
      invariantsCount,
      invariantsInjected,
      cached: isCached,
      symbols
    };
  }

  public formatInvariantHeader(
    filePath: string, 
    memories: MultiHopMemoryResult[], 
    tokenBudget: number = 500
  ): string {
    if (!memories || memories.length === 0) {
      return '';
    }

    // Sort: warnings/lessons first, then high confidence / direct depth
    const sorted = [...memories].sort((a, b) => {
      const typeScore = (t: string) => (t === 'warning' ? 3 : t === 'lesson' ? 2 : 1);
      const scoreDiff = typeScore(b.type) - typeScore(a.type);
      if (scoreDiff !== 0) return scoreDiff;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.confidence - a.confidence;
    });

    const maxChars = tokenBudget * 4; // ~4 chars per token budget
    let currentLength = 0;
    const selectedMemories: string[] = [];

    for (const mem of sorted) {
      const tagStr = mem.tags && mem.tags.length > 0 ? ` [${mem.tags.join(', ')}]` : '';
      const depthBadge = mem.depth > 0 ? ` (Hop ${mem.depth})` : ' (Direct)';
      const confBadge = `Confidence: ${(mem.confidence * 100).toFixed(0)}%`;
      
      let item = `- [${mem.type.toUpperCase()}] ${mem.title} (ID: ${mem.id}${depthBadge}, ${confBadge})${tagStr}\n`;
      if (mem.content) {
        const snippet = mem.content.length > 180 ? `${mem.content.substring(0, 180)}...` : mem.content;
        item += `  ${snippet.split('\n').join('\n  ')}\n`;
      }

      if (currentLength + item.length > maxChars && selectedMemories.length > 0) {
        selectedMemories.push(`- ... [${sorted.length - selectedMemories.length} additional graph memories omitted for token budget]`);
        break;
      }

      selectedMemories.push(item.trimEnd());
      currentLength += item.length;
    }

    return `### StormDrain Architectural Invariants & Caller Constraints: ${filePath} ###\n${selectedMemories.join('\n')}\n`;
  }

  public extractSymbolOutline(filePath: string, content: string): string[] {
    const ext = path.extname(filePath).toLowerCase();
    const symbols: string[] = [];

    const lines = content.split(/\r?\n/);

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      for (const line of lines) {
        const trimmed = line.trim();
        // Match export statements
        const exportMatch = trimmed.match(/^export\s+(async\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z0-9_$]+)/);
        if (exportMatch) {
          const kind = exportMatch[2];
          const name = exportMatch[3];
          symbols.push(`export ${kind} ${name}`);
          continue;
        }
        // Match non-exported top-level classes and functions
        const topMatch = trimmed.match(/^(class|interface|type|enum)\s+([A-Za-z0-9_$]+)/);
        if (topMatch) {
          symbols.push(`${topMatch[1]} ${topMatch[2]}`);
        }
      }
    } else if (['.py'].includes(ext)) {
      for (const line of lines) {
        const trimmed = line.trim();
        const pyMatch = trimmed.match(/^(class|def)\s+([A-Za-z0-9_]+)/);
        if (pyMatch) {
          symbols.push(`${pyMatch[1]} ${pyMatch[2]}`);
        }
      }
    } else if (['.rs'].includes(ext)) {
      for (const line of lines) {
        const trimmed = line.trim();
        const rsMatch = trimmed.match(/^(pub\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z0-9_]+)/);
        if (rsMatch) {
          symbols.push(`${rsMatch[1] || ''}${rsMatch[2]} ${rsMatch[3]}`);
        }
      }
    } else if (['.go'].includes(ext)) {
      for (const line of lines) {
        const trimmed = line.trim();
        const goMatch = trimmed.match(/^func\s+(\([A-Za-z0-9_*\s]+\)\s+)?([A-Za-z0-9_]+)/);
        if (goMatch) {
          symbols.push(`func ${goMatch[2]}`);
        }
        const typeMatch = trimmed.match(/^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/);
        if (typeMatch) {
          symbols.push(`type ${typeMatch[1]} ${typeMatch[2]}`);
        }
      }
    }

    return symbols.slice(0, 30); // Cap at 30 top symbols for conciseness
  }
}
