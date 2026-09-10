import { describe, it, expect } from 'vitest';
import { HaskellParser } from './haskellParser';

describe('HaskellParser', () => {
  const parser = new HaskellParser();

  it('should parse imports and resolve against workspace files', () => {
    const content = `
{-# LANGUAGE OverloadedStrings #-}
-- Main module
module Main where

import Brick
import qualified Brick.Widgets.Edit as E
import Control.Monad (forever)

import Lambda.Config (loadConfig, Config(..))
import qualified Lambda.UI.Draw as Draw
import Lambda.Core.EngineInterface
import Lambda.Types
`;

    const allFiles = new Set([
      'app/Main.hs',
      'src/Lambda/Config.hs',
      'src/Lambda/UI/Draw.hs',
      'src/Lambda/Core/EngineInterface.hs',
      'src/Lambda/Types.hs'
    ]);

    const imports = parser.parseImports('app/Main.hs', content, {
      fileDir: 'app',
      relativeFilePath: 'app/Main.hs',
      workspaceDir: '/workspace',
      allFiles
    });

    expect(imports).toContain('src/Lambda/Config.hs');
    expect(imports).toContain('src/Lambda/UI/Draw.hs');
    expect(imports).toContain('src/Lambda/Core/EngineInterface.hs');
    expect(imports).toContain('src/Lambda/Types.hs');
    // External imports must not be included
    expect(imports).not.toContain('Brick');
    expect(imports).not.toContain('Control/Monad');
  });

  it('should extract Haskell symbols (data, newtype, type, class, instance, signatures)', () => {
    const content = `
module Lambda.Types where

-- Types
data EngineEvent = StepTurn | StopTurn
newtype EngineId = EngineId String
type Buffer = [String]

class MonadEngine m where
  step :: m ()

instance Show EngineEvent where
  show StepTurn = "StepTurn"

theApp :: App UIState EngineEvent ResourceName
theApp = undefined

main :: IO ()
main = putStrLn "hello"
`;

    const symbols = parser.extractSymbols('src/Lambda/Types.hs', content);

    expect(symbols).toContain('data EngineEvent');
    expect(symbols).toContain('newtype EngineId');
    expect(symbols).toContain('type Buffer');
    expect(symbols).toContain('class MonadEngine');
    expect(symbols).toContain('instance Show EngineEvent');
    expect(symbols).toContain('theApp :: App UIState EngineEvent ResourceName');
    expect(symbols).toContain('main :: IO ()');
  });

  it('should strip comments and compiler pragmas properly', () => {
    const content = `
{-# LANGUAGE OverloadedStrings #-}
{- Block comment with
   import Fake.Module
-}
-- import Fake.Other
import Real.Module
`;
    const allFiles = new Set(['src/Real/Module.hs']);

    const imports = parser.parseImports('app/Main.hs', content, {
      fileDir: 'app',
      relativeFilePath: 'app/Main.hs',
      workspaceDir: '/workspace',
      allFiles
    });

    expect(imports).toEqual(['src/Real/Module.hs']);
  });
});
