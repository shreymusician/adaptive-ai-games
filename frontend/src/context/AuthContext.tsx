import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authAPI, tokenStorage } from '../services/api';
import type { User } from '../services/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signup: (email: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      if (!tokenStorage.get()) {
        setLoading(false);
        return;
      }
      try {
        const { user: currentUser } = await authAPI.me();
        setUser(currentUser);
      } catch (error) {
        tokenStorage.clear();
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    const { token, user: newUser } = await authAPI.signup(email, password, name);
    tokenStorage.set(token);
    setUser(newUser);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: loggedInUser } = await authAPI.login(email, password);
    tokenStorage.set(token);
    setUser(loggedInUser);
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const { token, user: googleUser } = await authAPI.loginWithGoogle(idToken);
    tokenStorage.set(token);
    setUser(googleUser);
  }, []);

  const logout = useCallback(() => {
    tokenStorage.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
