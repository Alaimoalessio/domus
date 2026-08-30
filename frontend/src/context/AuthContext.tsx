import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { importKey } from '../lib/crypto/aes';

interface AuthContextType {
  token: string | null;
  masterKey: CryptoKey | null;
  userId: string | null;
  login: (token: string, userId: string, rawMasterKey: Uint8Array) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTO_LOCK_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const logout = useCallback(() => {
    setToken(null);
    setMasterKey(null);
    setUserId(null);
    // Explicitly clearing just in case
    sessionStorage.clear();
  }, []);

  const login = async (newToken: string, newUserId: string, rawMasterKey: Uint8Array) => {
    const key = await importKey(rawMasterKey);
    setToken(newToken);
    setUserId(newUserId);
    setMasterKey(key);
  };

  // Auto-Lock hook logic built directly into the provider
  useEffect(() => {
    if (!token) return;

    let timeoutId: number;

    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        console.warn('Auto-locking due to inactivity');
        logout();
      }, AUTO_LOCK_TIMEOUT);
    };

    // Listen to user activity to reset the timer
    const events = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'];
    events.forEach((event) => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    // Start timer immediately
    resetTimer();

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [token, logout]);

  return (
    <AuthContext.Provider
      value={{
        token,
        masterKey,
        userId,
        login,
        logout,
        isAuthenticated: !!token && !!masterKey,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
