import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Wraps routes that are only accessible to Admin users.
 * Non-admins are redirected to /roads (the first Project Management page).
 */
export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (!user || !["Admin", "Super Admin"].includes(user.role)) {
    return <Navigate to="/roads" replace />;
  }

  return <>{children}</>;
}
