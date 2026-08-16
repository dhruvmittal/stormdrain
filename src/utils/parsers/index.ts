import * as path from 'path';
import { LanguageParser } from './types';
import { TsParser } from './tsParser';
import { MatlabParser } from './matlabParser';
import { CppParser } from './cppParser';
import { PythonParser } from './pythonParser';
import { GenericParser } from './genericParser';

const tsParser = new TsParser();
const matlabParser = new MatlabParser();
const cppParser = new CppParser();
const pythonParser = new PythonParser();
const genericParser = new GenericParser();

export function getParserForFile(filePath: string): LanguageParser {
  const ext = path.extname(filePath).toLowerCase();

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return tsParser;
  }
  if (ext === '.m') {
    return matlabParser;
  }
  if (['.cpp', '.hpp', '.cc', '.cxx', '.c', '.h', '.hh'].includes(ext)) {
    return cppParser;
  }
  if (ext === '.py') {
    return pythonParser;
  }

  return genericParser;
}

export * from './types';
export * from './tsParser';
export * from './matlabParser';
export * from './cppParser';
export * from './pythonParser';
export * from './genericParser';
