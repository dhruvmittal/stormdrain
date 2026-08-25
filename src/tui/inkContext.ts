import React, { createContext, useContext } from 'react';

export interface InkContextValue {
  Box: any;
  Text: any;
  useApp: () => { exit: (error?: Error) => void };
  useInput: (inputHandler: (input: string, key: any) => void) => void;
}

export const InkContext = createContext<InkContextValue | null>(null);

export const useInk = (): InkContextValue => {
  const ctx = useContext(InkContext);
  if (!ctx) {
    throw new Error('useInk must be used within InkProvider');
  }
  return ctx;
};
