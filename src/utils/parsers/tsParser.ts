import * as path from 'path';
import { LanguageParser, ParseOptions } from './types';

function getTsModule(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req = require('typescript');
    if (typeof req.createSourceFile === 'function') return req;
    if (req.default && typeof req.default.createSourceFile === 'function') return req.default;
    return req;
  } catch {
    return {};
  }
}

const ts = getTsModule();

export class TsParser implements LanguageParser {
  public parseImports(filePath: string, content: string, options: ParseOptions): string[] {
    const importedFiles = new Set<string>();

    if (typeof ts.createSourceFile === 'function') {
      const ext = path.extname(filePath).toLowerCase();
      const scriptKind = ext === '.tsx' ? ts.ScriptKind?.TSX || 4 : ext === '.jsx' ? ts.ScriptKind?.JSX || 2 : ext === '.js' ? ts.ScriptKind?.JS || 1 : ts.ScriptKind?.TS || 3;
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget?.Latest || 99, true, scriptKind);

      const visitNode = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            this.resolveCandidateImport(node.moduleSpecifier.text, options.fileDir, options.allFiles, importedFiles);
          }
        }
        if (ts.isCallExpression(node)) {
          const expressionText = node.expression.getText(sourceFile);
          if ((expressionText === 'require' || expressionText === 'import') && node.arguments.length > 0) {
            const arg = node.arguments[0];
            if (ts.isStringLiteral(arg)) {
              this.resolveCandidateImport(arg.text, options.fileDir, options.allFiles, importedFiles);
            }
          }
        }
        ts.forEachChild(node, visitNode);
      };

      visitNode(sourceFile);
    } else {
      // Regex fallback
      const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      const importRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
      const requireRegex = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(cleanContent)) !== null) {
        this.resolveCandidateImport(match[1], options.fileDir, options.allFiles, importedFiles);
      }
      while ((match = requireRegex.exec(cleanContent)) !== null) {
        this.resolveCandidateImport(match[1], options.fileDir, options.allFiles, importedFiles);
      }
    }

    importedFiles.delete(options.relativeFilePath);
    return Array.from(importedFiles);
  }

  public extractSymbols(filePath: string, content: string): string[] {
    const symbols: string[] = [];

    if (typeof ts.createSourceFile === 'function') {
      const ext = path.extname(filePath).toLowerCase();
      const scriptKind = ext === '.tsx' ? ts.ScriptKind?.TSX || 4 : ext === '.jsx' ? ts.ScriptKind?.JSX || 2 : ext === '.js' ? ts.ScriptKind?.JS || 1 : ts.ScriptKind?.TS || 3;
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget?.Latest || 99, true, scriptKind);

      const isExported = (node: ts.Node): boolean => {
        if (!ts.canHaveModifiers(node)) return false;
        const modifiers = ts.getModifiers(node);
        return Boolean(modifiers && modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
      };

      for (const statement of sourceFile.statements) {
        const exportedPrefix = isExported(statement) ? 'export ' : '';

        if (ts.isClassDeclaration(statement) && statement.name) {
          symbols.push(`${exportedPrefix}class ${statement.name.text}`);
        } else if (ts.isInterfaceDeclaration(statement)) {
          symbols.push(`${exportedPrefix}interface ${statement.name.text}`);
        } else if (ts.isTypeAliasDeclaration(statement)) {
          symbols.push(`${exportedPrefix}type ${statement.name.text}`);
        } else if (ts.isEnumDeclaration(statement)) {
          symbols.push(`${exportedPrefix}enum ${statement.name.text}`);
        } else if (ts.isFunctionDeclaration(statement) && statement.name) {
          symbols.push(`${exportedPrefix}function ${statement.name.text}`);
        } else if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              symbols.push(`${exportedPrefix}const ${decl.name.text}`);
            }
          }
        }
      }
    } else {
      // Regex fallback
      const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      const symbolRegex = /^\s*(export\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z0-9_$]+)/gm;
      let match: RegExpExecArray | null;
      while ((match = symbolRegex.exec(cleanContent)) !== null) {
        const exportPrefix = match[1] ? 'export ' : '';
        symbols.push(`${exportPrefix}${match[2]} ${match[3]}`);
      }
    }

    return symbols.slice(0, 30);
  }

  private resolveCandidateImport(rawImport: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
    let cleanImport = rawImport.replace(/\\/g, '/');
    if (cleanImport.startsWith('.')) {
      const directRel = path.normalize(path.join(fileDir, cleanImport)).replace(/\\/g, '/');
      const candidates = [
        directRel,
        `${directRel}.ts`, `${directRel}.tsx`, `${directRel}.js`, `${directRel}.jsx`,
        `${directRel}/index.ts`, `${directRel}/index.js`
      ];

      for (const cand of candidates) {
        if (allFiles.has(cand)) {
          outSet.add(cand);
          return;
        }
      }
    }

    const base = path.basename(cleanImport).replace(/\.(ts|js|tsx|jsx)$/, '');
    for (const file of allFiles) {
      const fileBase = path.basename(file, path.extname(file));
      if (fileBase.toLowerCase() === base.toLowerCase()) {
        outSet.add(file);
        return;
      }
    }
  }
}
