import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  organisation: string;
  role: "Road Surveyor" | "Asset Manager" | "Admin";
  verified: boolean;
}

interface AuthContextType {
  user: User | null;
  signUp: (userData: Omit<User, "id" | "verified">) => Promise<{ success: boolean; userId?: string }>;
  verifyCode: (userId: string, code: string) => Promise<{ success: boolean }>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Load user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem("auth_user");
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      if (parsedUser.verified) {
        setUser(parsedUser);
        setIsAuthenticated(true);
      }
    }
  }, []);

  const signUp = async (userData: Omit<User, "id" | "verified">) => {
    // Get existing users
    const usersJson = localStorage.getItem("app_users") || "[]";
    const users = JSON.parse(usersJson);

    // Check if email already exists
    if (users.find((u: User) => u.email === userData.email)) {
      return { success: false };
    }

    // Create new user
    const newUser: User = {
      ...userData,
      id: `user_${Date.now()}`,
      verified: false,
    };

    // Store password separately (in real app this would be hashed on backend)
    const passwordsJson = localStorage.getItem("app_passwords") || "{}";
    const passwords = JSON.parse(passwordsJson);
    passwords[newUser.id] = userData.email; // Using email as password for demo
    localStorage.setItem("app_passwords", JSON.stringify(passwords));

    // Add to users list
    users.push(newUser);
    localStorage.setItem("app_users", JSON.stringify(users));

    return { success: true, userId: newUser.id };
  };

  const verifyCode = async (userId: string, code: string) => {
    // Accept only "123456" as valid code
    if (code !== "123456") {
      return { success: false };
    }

    // Get user and mark as verified
    const usersJson = localStorage.getItem("app_users") || "[]";
    const users = JSON.parse(usersJson);
    const userIndex = users.findIndex((u: User) => u.id === userId);

    if (userIndex === -1) {
      return { success: false };
    }

    users[userIndex].verified = true;
    localStorage.setItem("app_users", JSON.stringify(users));

    // Set as current user
    const verifiedUser = users[userIndex];
    setUser(verifiedUser);
    setIsAuthenticated(true);
    localStorage.setItem("auth_user", JSON.stringify(verifiedUser));

    return { success: true };
  };

  const login = async (email: string, password: string) => {
    // Get users
    const usersJson = localStorage.getItem("app_users") || "[]";
    const users: User[] = JSON.parse(usersJson);

    // Find user by email
    const foundUser = users.find((u) => u.email === email);

    if (!foundUser) {
      return { success: false, error: "Invalid email or password" };
    }

    if (!foundUser.verified) {
      return { success: false, error: "Please verify your email first" };
    }

    // In this demo, we're using a simple password check
    // In production, this would verify against hashed passwords on the backend
    const passwordsJson = localStorage.getItem("app_passwords") || "{}";
    const passwords = JSON.parse(passwordsJson);
    
    // For demo: accept the password field or the stored value
    if (passwords[foundUser.id] !== password && password !== "demo123") {
      return { success: false, error: "Invalid email or password" };
    }

    // Set as current user
    setUser(foundUser);
    setIsAuthenticated(true);
    localStorage.setItem("auth_user", JSON.stringify(foundUser));

    return { success: true };
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem("auth_user");
  };

  return (
    <AuthContext.Provider value={{ user, signUp, verifyCode, login, logout, isAuthenticated }}>
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
