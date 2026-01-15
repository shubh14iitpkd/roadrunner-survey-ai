import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "@/lib/api";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  organisation: string;
  role: "Road Surveyor" | "Asset Manager" | "Admin" | "Viewer";
  verified: boolean;
}

interface AuthContextType {
  user: User | null;
  signUp: (userData: Omit<User, "id" | "verified"> & { password: string }) => Promise<{ success: boolean; userId?: string; error?: string }>;
  verifyCode: (userId: string, code: string) => Promise<{ success: boolean }>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedUser = localStorage.getItem("auth_user");
        const storedTokens = localStorage.getItem("auth_tokens");

        if (storedUser && storedTokens) {
          const parsedUser = JSON.parse(storedUser);
          const tokens = JSON.parse(storedTokens);

          // Verify the token is still valid by calling /api/auth/me
          try {
            const resp = await api.auth.me();
            const backendUser = resp.user;

            // Update user data from backend
            const mapped: User = {
              id: backendUser._id,
              email: backendUser.email,
              first_name: backendUser.first_name || backendUser.name || "",
              last_name: backendUser.last_name || "",
              organisation: backendUser.organisation || "",
              role: backendUser.role,
              verified: true,
            };

            setUser(mapped);
            setIsAuthenticated(true);
            localStorage.setItem("auth_user", JSON.stringify(mapped));
          } catch (error) {
            // Token is invalid or expired, clear auth
            console.error("Token validation failed:", error);
            localStorage.removeItem("auth_user");
            localStorage.removeItem("auth_tokens");
            setUser(null);
            setIsAuthenticated(false);
          }
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const signUp = async (userData: Omit<User, "id" | "verified"> & { password: string }) => {
    try {
      const name = `${userData.first_name || ""} ${userData.last_name || ""}`.trim();
      const resp = await api.auth.signup({
        name,
        email: userData.email,
        password: userData.password,
        role: userData.role,
        first_name: userData.first_name,
        last_name: userData.last_name,
        organisation: userData.organisation,
      });
      const tokens = { access_token: resp.access_token, refresh_token: resp.refresh_token };
      localStorage.setItem("auth_tokens", JSON.stringify(tokens));
      const backendUser = resp.user;
      const mapped: User = {
        id: backendUser._id,
        email: backendUser.email,
        first_name: backendUser.first_name || userData.first_name || backendUser.name || "",
        last_name: backendUser.last_name || userData.last_name || "",
        organisation: backendUser.organisation || userData.organisation || "",
        role: backendUser.role,
        verified: true,
      };
      setUser(mapped);
      setIsAuthenticated(true);
      localStorage.setItem("auth_user", JSON.stringify(mapped));
      return { success: true, userId: mapped.id };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const verifyCode = async (userId: string, code: string) => {
    return { success: true };
  };

  const login = async (email: string, password: string) => {
    try {
      const resp = await api.auth.login(email, password);
      const tokens = { access_token: resp.access_token, refresh_token: resp.refresh_token };
      localStorage.setItem("auth_tokens", JSON.stringify(tokens));
      const backendUser = resp.user;
      const mapped: User = {
        id: backendUser._id,
        email: backendUser.email,
        first_name: backendUser.first_name || backendUser.name || "",
        last_name: backendUser.last_name || "",
        organisation: backendUser.organisation || "",
        role: backendUser.role,
        verified: true,
      };
      setUser(mapped);
      setIsAuthenticated(true);
      localStorage.setItem("auth_user", JSON.stringify(mapped));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_tokens");
  };

  return (
    <AuthContext.Provider value={{ user, signUp, verifyCode, login, logout, isAuthenticated, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
