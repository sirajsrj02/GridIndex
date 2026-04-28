import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMe } from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [customer, setCustomer] = useState(() => {
    try {
      const stored = localStorage.getItem('gi_customer');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  // Verify token and hydrate fresh customer data on mount
  useEffect(() => {
    const token = localStorage.getItem('gi_token');
    if (!token) {
      setLoading(false);
      return;
    }
    getMe()
      .then((c) => {
        setCustomer(c);
        localStorage.setItem('gi_customer', JSON.stringify(c));
      })
      .catch(() => {
        localStorage.removeItem('gi_token');
        localStorage.removeItem('gi_customer');
        setCustomer(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((token, customerData) => {
    localStorage.setItem('gi_token', token);
    localStorage.setItem('gi_customer', JSON.stringify(customerData));
    setCustomer(customerData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('gi_token');
    localStorage.removeItem('gi_customer');
    setCustomer(null);
  }, []);

  const refreshCustomer = useCallback(async () => {
    try {
      const c = await getMe();
      setCustomer(c);
      localStorage.setItem('gi_customer', JSON.stringify(c));
      return c;
    } catch {
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider value={{ customer, loading, login, logout, refreshCustomer }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
