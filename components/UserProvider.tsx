'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface UserContextType {
  userEmail: string | null;
  setUserEmail: (email: string) => void;
  clearUserEmail: () => void;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const COOKIE_NAME = 'lotlister_user_email';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    const cookieValue = parts.pop()?.split(';').shift();
    return cookieValue ? decodeURIComponent(cookieValue) : null;
  }
  return null;
}

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [userEmail, setUserEmailState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing cookie on mount
    const email = getCookie(COOKIE_NAME);
    if (email) {
      setUserEmailState(email);
    }
    setIsLoading(false);
  }, []);

  const setUserEmail = (email: string) => {
    const normalizedEmail = email.toLowerCase().trim();
    setCookie(COOKIE_NAME, normalizedEmail, COOKIE_MAX_AGE);
    setUserEmailState(normalizedEmail);
  };

  const clearUserEmail = () => {
    deleteCookie(COOKIE_NAME);
    setUserEmailState(null);
  };

  return (
    <UserContext.Provider value={{ userEmail, setUserEmail, clearUserEmail, isLoading }}>
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
