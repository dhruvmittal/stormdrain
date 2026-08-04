import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanWorkspaceSourceFiles, parseFileImports, generateWorkspaceFileVertices } from './fileGraphScanner';

describe('fileGraphScanner', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `file_graph_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Create multi-language directory structure
    fs.mkdirSync(path.join(testDir, 'cpp'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'matlab'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'python'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'ts'), { recursive: true });

    // 1. C++ files
    fs.writeFileSync(path.join(testDir, 'cpp', 'math_utils.h'), '// C++ Math Header\n#ifndef MATH_H\n#define MATH_H\n#endif\n');
    fs.writeFileSync(path.join(testDir, 'cpp', 'main.cpp'), '// C++ Main\n#include "math_utils.h"\nint main() { return 0; }\n');

    // 2. MATLAB files
    fs.writeFileSync(path.join(testDir, 'matlab', 'helper.m'), '% MATLAB Helper function\nfunction y = helper(x)\ny = x * 2;\nend\n');
    fs.writeFileSync(path.join(testDir, 'matlab', 'solver.m'), '% MATLAB Solver\nfunction res = solver(val)\nres = helper(val) + 1;\nend\n');

    // 3. Python files
    fs.writeFileSync(path.join(testDir, 'python', 'utils.py'), '# Python Utils\ndef calc(): return 42\n');
    fs.writeFileSync(path.join(testDir, 'python', 'app.py'), '# Python App\nfrom utils import calc\nimport sys\n');

    // 4. TypeScript files
    fs.writeFileSync(path.join(testDir, 'ts', 'config.ts'), '// Config\nexport const PORT = 8080;\n');
    fs.writeFileSync(path.join(testDir, 'ts', 'server.ts'), '// Server\nimport { PORT } from "./config";\n');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should scan source files across C++, MATLAB, Python, and TypeScript', () => {
    const files = scanWorkspaceSourceFiles(testDir);
    expect(files).toContain(path.normalize('cpp/main.cpp').replace(/\\/g, '/'));
    expect(files).toContain(path.normalize('cpp/math_utils.h').replace(/\\/g, '/'));
    expect(files).toContain(path.normalize('matlab/solver.m').replace(/\\/g, '/'));
    expect(files).toContain(path.normalize('matlab/helper.m').replace(/\\/g, '/'));
    expect(files).toContain(path.normalize('python/app.py').replace(/\\/g, '/'));
    expect(files).toContain(path.normalize('ts/server.ts').replace(/\\/g, '/'));
  });

  it('should parse C++ #include dependencies correctly', () => {
    const allFiles = new Set(scanWorkspaceSourceFiles(testDir));
    const imports = parseFileImports(testDir, path.normalize('cpp/main.cpp').replace(/\\/g, '/'), allFiles);
    expect(imports).toContain(path.normalize('cpp/math_utils.h').replace(/\\/g, '/'));
  });

  it('should parse MATLAB function references correctly', () => {
    const allFiles = new Set(scanWorkspaceSourceFiles(testDir));
    const imports = parseFileImports(testDir, path.normalize('matlab/solver.m').replace(/\\/g, '/'), allFiles);
    expect(imports).toContain(path.normalize('matlab/helper.m').replace(/\\/g, '/'));
  });

  it('should parse Python import references correctly', () => {
    const allFiles = new Set(scanWorkspaceSourceFiles(testDir));
    const imports = parseFileImports(testDir, path.normalize('python/app.py').replace(/\\/g, '/'), allFiles);
    expect(imports).toContain(path.normalize('python/utils.py').replace(/\\/g, '/'));
  });

  it('should parse TypeScript import references correctly', () => {
    const allFiles = new Set(scanWorkspaceSourceFiles(testDir));
    const imports = parseFileImports(testDir, path.normalize('ts/server.ts').replace(/\\/g, '/'), allFiles);
    expect(imports).toContain(path.normalize('ts/config.ts').replace(/\\/g, '/'));
  });

  it('should generate workspace file vertices with import relations', () => {
    const vertices = generateWorkspaceFileVertices(testDir);
    expect(vertices.length).toBeGreaterThanOrEqual(8);
    const serverVertex = vertices.find(v => v.relativePath.endsWith('server.ts'));
    expect(serverVertex).toBeDefined();
    expect(serverVertex?.imports.some(i => i.endsWith('config.ts'))).toBe(true);
  });
});
