'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import type { DelegatePermissionLevel } from '@/lib/types';

interface ActiveProfileState {
  dependentId: string | null;
  dependentName: string | null;
  setActiveProfile: (id: string | null, name: string | null) => void;
  // Delegate mode
  delegateOwnerId: string | null;
  delegateOwnerName: string | null;
  delegatePermission: DelegatePermissionLevel | null;
  setDelegateProfile: (
    ownerId: string | null,
    name: string | null,
    permission: DelegatePermissionLevel | null,
  ) => void;
}

const ActiveProfileContext = createContext<ActiveProfileState>({
  dependentId: null,
  dependentName: null,
  setActiveProfile: () => {},
  delegateOwnerId: null,
  delegateOwnerName: null,
  delegatePermission: null,
  setDelegateProfile: () => {},
});

export function ActiveProfileProvider({ children }: { children: React.ReactNode }) {
  const [dependentId, setDependentId] = useState<string | null>(null);
  const [dependentName, setDependentName] = useState<string | null>(null);
  const [delegateOwnerId, setDelegateOwnerId] = useState<string | null>(null);
  const [delegateOwnerName, setDelegateOwnerName] = useState<string | null>(null);
  const [delegatePermission, setDelegatePermission] = useState<DelegatePermissionLevel | null>(null);

  const setActiveProfile = useCallback((id: string | null, name: string | null) => {
    setDependentId(id);
    setDependentName(name);
    // Clear delegate fields when switching to own or dependent profile
    setDelegateOwnerId(null);
    setDelegateOwnerName(null);
    setDelegatePermission(null);
  }, []);

  const setDelegateProfile = useCallback(
    (
      ownerId: string | null,
      name: string | null,
      permission: DelegatePermissionLevel | null,
    ) => {
      setDelegateOwnerId(ownerId);
      setDelegateOwnerName(name);
      setDelegatePermission(permission);
      // Clear dependent when switching to delegate mode
      setDependentId(null);
      setDependentName(null);
    },
    [],
  );

  return (
    <ActiveProfileContext.Provider
      value={{
        dependentId,
        dependentName,
        setActiveProfile,
        delegateOwnerId,
        delegateOwnerName,
        delegatePermission,
        setDelegateProfile,
      }}
    >
      {children}
    </ActiveProfileContext.Provider>
  );
}

export function useActiveProfile() {
  return useContext(ActiveProfileContext);
}
