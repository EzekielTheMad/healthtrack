'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import React from 'react';

export interface ActiveProfileState {
  dependentId: string | null; // null = self
  dependentName: string | null;
  setActiveProfile: (dependentId: string | null, name: string | null) => void;
}

const ActiveProfileContext = createContext<ActiveProfileState | undefined>(
  undefined,
);

export function ActiveProfileProvider({ children }: { children: ReactNode }) {
  const [dependentId, setDependentId] = useState<string | null>(null);
  const [dependentName, setDependentName] = useState<string | null>(null);

  const setActiveProfile = useCallback(
    (id: string | null, name: string | null) => {
      setDependentId(id);
      setDependentName(name);
    },
    [],
  );

  return React.createElement(
    ActiveProfileContext.Provider,
    { value: { dependentId, dependentName, setActiveProfile } },
    children,
  );
}

export function useActiveProfile(): ActiveProfileState {
  const context = useContext(ActiveProfileContext);
  if (context === undefined) {
    throw new Error(
      'useActiveProfile must be used within an ActiveProfileProvider',
    );
  }
  return context;
}
