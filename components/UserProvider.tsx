'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

interface UserContextType {
  /** eBay username of the signed-in user, or null when signed out. */
  username: string | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setUsername(data.data.username);
      })
      .catch(() => setUsername(null))
      .finally(() => setIsLoading(false));
  }, []);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUsername(null);
    window.location.href = '/lots';
  }, []);

  return (
    <UserContext.Provider value={{ username, isLoading, signOut }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
