import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  scanWorkspaceSourceFiles,
  parseFileImports,
  generateWorkspaceFileVertices,
  makeFileVertexId
} from './fileGraphScanner';

describe('Multi-Language Scanner Resilience Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-scanner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('C++ / C Header & Local vs System Includes', () => {
    it('should link local headers and ignore missing system standard library includes', () => {
      const headerPath = path.join(tempDir, 'engine.hpp');
      const cppPath = path.join(tempDir, 'engine.cpp');

      fs.writeFileSync(headerPath, '#pragma once\nclass Engine {};\n');
      fs.writeFileSync(cppPath, `
        #include <iostream>
        #include <vector>
        #include <memory>
        #include "engine.hpp"
        
        void run() { std::cout << "Engine running"; }
      `);

      const allFiles = new Set(['engine.hpp', 'engine.cpp']);
      const imports = parseFileImports(tempDir, 'engine.cpp', allFiles);

      expect(imports).toContain('engine.hpp');
      expect(imports).not.toContain('iostream');
      expect(imports).not.toContain('vector');
      expect(imports).not.toContain('memory');
    });
  });

  describe('MATLAB Function & Package Resolution', () => {
    it('should resolve sibling .m files and package imports', () => {
      const scriptA = path.join(tempDir, 'main_sim.m');
      const funcB = path.join(tempDir, 'rk4_step.m');

      fs.writeFileSync(scriptA, `
        % Main Simulation Script
        import pkg.controllers.*
        dt = 0.01;
        state = rk4_step(state, dt);
      `);
      fs.writeFileSync(funcB, `
        function nextState = rk4_step(state, dt)
          nextState = state;
        end
      `);

      const allFiles = new Set(['main_sim.m', 'rk4_step.m']);
      const imports = parseFileImports(tempDir, 'main_sim.m', allFiles);

      expect(imports).toContain('rk4_step.m');
    });
  });

  describe('Python Relative & Standard Module Imports', () => {
    it('should resolve local module imports and relative dot imports', () => {
      const dirPkg = path.join(tempDir, 'mypkg');
      fs.mkdirSync(dirPkg, { recursive: true });

      const fileInit = path.join(dirPkg, '__init__.py');
      const fileUtils = path.join(dirPkg, 'utils.py');
      const fileCore = path.join(dirPkg, 'core.py');

      fs.writeFileSync(fileInit, '');
      fs.writeFileSync(fileUtils, 'def helper(): pass\n');
      fs.writeFileSync(fileCore, `
        import os
        import sys
        from .utils import helper
        from mypkg.utils import helper as h2
      `);

      const allFiles = new Set(['mypkg/utils.py', 'mypkg/core.py', 'mypkg/__init__.py']);
      const imports = parseFileImports(tempDir, 'mypkg/core.py', allFiles);

      expect(imports).toContain('mypkg/utils.py');
      expect(imports).not.toContain('os');
      expect(imports).not.toContain('sys');
    });
  });

  describe('Rust Modules & Crate Use Statements', () => {
    it('should resolve mod and use crate declarations', () => {
      const mainRs = path.join(tempDir, 'main.rs');
      const helperRs = path.join(tempDir, 'helper.rs');

      fs.writeFileSync(helperRs, 'pub fn do_work() {}\n');
      fs.writeFileSync(mainRs, `
        mod helper;
        use crate::helper;
        fn main() { helper::do_work(); }
      `);

      const allFiles = new Set(['main.rs', 'helper.rs']);
      const imports = parseFileImports(tempDir, 'main.rs', allFiles);

      expect(imports).toContain('helper.rs');
    });
  });

  describe('Error Handling & Inaccessible Files', () => {
    it('should return empty imports for non-existent files gracefully', () => {
      const imports = parseFileImports(tempDir, 'ghost_file.ts', new Set());
      expect(imports).toEqual([]);
    });

    it('should extract top comments for headers or scripts', () => {
      const srcPath = path.join(tempDir, 'documented.py');
      fs.writeFileSync(srcPath, '#!/usr/bin/env python3\n# High performance pipeline\n# Author: Team\ndef run(): pass\n');

      const vertices = generateWorkspaceFileVertices(tempDir);
      const docVertex = vertices.find(v => v.relativePath === 'documented.py');

      expect(docVertex).toBeDefined();
      expect(docVertex?.content).toContain('# High performance pipeline');
      expect(docVertex?.hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });
});
