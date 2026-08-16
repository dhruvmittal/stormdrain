import { describe, it, expect } from 'vitest';
import { MatlabParser } from './matlabParser';

describe('MatlabParser', () => {
  const parser = new MatlabParser();
  const allFiles = new Set<string>([
    'main.m',
    'compute_matrix.m',
    'run_simulation.m',
    'helper_func.m',
    '+utils/+math/solve_system.m',
    'BaseClass.m'
  ]);

  it('should parse parenthesized and command-style function calls', () => {
    const code = `
      % This is a comment calling compute_matrix(x)
      compute_matrix(data);
      run_simulation config_data;
    `;

    const imports = parser.parseImports('main.m', code, {
      fileDir: '.',
      relativeFilePath: 'main.m',
      workspaceDir: '.',
      allFiles
    });

    expect(imports).toContain('compute_matrix.m');
    expect(imports).toContain('run_simulation.m');
  });

  it('should parse classdef superclass inheritance and static method calls', () => {
    const code = `
      classdef MyModel < BaseClass
        methods
          function obj = MyModel()
            helper_func(42);
          end
        end
      end
    `;

    const imports = parser.parseImports('MyModel.m', code, {
      fileDir: '.',
      relativeFilePath: 'MyModel.m',
      workspaceDir: '.',
      allFiles
    });

    expect(imports).toContain('BaseClass.m');
    expect(imports).toContain('helper_func.m');
  });

  it('should handle case-insensitive matching on Linux filesystems', () => {
    const code = `
      COMPUTE_MATRIX(x);
      Run_Simulation config;
    `;

    const imports = parser.parseImports('main.m', code, {
      fileDir: '.',
      relativeFilePath: 'main.m',
      workspaceDir: '.',
      allFiles
    });

    expect(imports).toContain('compute_matrix.m');
    expect(imports).toContain('run_simulation.m');
  });

  it('should join multi-line statements with line continuations (...)', () => {
    const code = `
      compute_matrix(...
        data);
    `;

    const imports = parser.parseImports('main.m', code, {
      fileDir: '.',
      relativeFilePath: 'main.m',
      workspaceDir: '.',
      allFiles
    });

    expect(imports).toContain('compute_matrix.m');
  });

  it('should exclude local subfunctions declared within the same file', () => {
    const code = `
      function main()
        local_helper();
        compute_matrix();
      end

      function local_helper()
        disp('internal');
      end
    `;

    const imports = parser.parseImports('main.m', code, {
      fileDir: '.',
      relativeFilePath: 'main.m',
      workspaceDir: '.',
      allFiles
    });

    expect(imports).toContain('compute_matrix.m');
    expect(imports).not.toContain('local_helper.m');
  });
});
