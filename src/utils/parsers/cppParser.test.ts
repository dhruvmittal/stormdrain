import { describe, it, expect } from 'vitest';
import { CppParser } from './cppParser';

describe('CppParser', () => {
  const parser = new CppParser();
  const allFiles = new Set<string>([
    'src/main.cpp',
    'src/utils.h',
    'src/utils.cpp',
    'include/engine.hpp'
  ]);

  it('should parse #include statements and pair headers with source files', () => {
    const code = `
      #include "utils.h"
      #include <engine.hpp>

      int main() {
        return 0;
      }
    `;

    const imports = parser.parseImports('src/main.cpp', code, {
      fileDir: 'src',
      relativeFilePath: 'src/main.cpp',
      workspaceDir: '.',
      allFiles
    });

    expect(imports).toContain('src/utils.h');
    expect(imports).toContain('src/utils.cpp'); // Header-to-source auto-pairing
  });

  it('should extract top-level class, struct, and function symbols', () => {
    const code = `
      class MatrixEngine {
      public:
        void compute();
      };
      struct VectorData { int x; };
    `;

    const symbols = parser.extractSymbols('src/main.cpp', code);
    expect(symbols).toContain('class MatrixEngine');
    expect(symbols).toContain('struct VectorData');
  });
});
