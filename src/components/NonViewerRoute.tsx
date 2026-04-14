import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Wraps routes that should not be accessible to Viewer users.
 * Viewers are redirected to the home page.
 */
export default function NonViewerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (!user || user.role === "Viewer") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
