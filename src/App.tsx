import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import PageLoader from "./components/PageLoader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "./contexts/AuthContext";
import { UploadProvider } from "./contexts/UploadContext";
import { LabelMapProvider } from "./contexts/LabelMapContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

// Lazy load pages for better performance
const Dashboard = lazy(() => import("./pages/Dashboard"));
const RoadRegister = lazy(() => import("./pages/RoadRegister"));
const SurveyUpload = lazy(() => import("./pages/SurveyUpload"));
const VideoLibrary = lazy(() => import("./pages/VideoLibrary"));
const AssetRegister = lazy(() => import("./pages/AssetRegister"));
const GISView = lazy(() => import("./pages/GISView"));
const AskAI = lazy(() => import("./pages/AskAI"));
const Settings = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));
const SignUp = lazy(() => import("./pages/SignUp"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AuthProvider>
            <LabelMapProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<SignUp />} />
                {/* Protected routes */}
                <Route
                  path="/*"
                  element={
                    <ProtectedRoute>
                      <UploadProvider>
                        <Layout>
                          <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/roads" element={<RoadRegister />} />
                            <Route path="/upload" element={<SurveyUpload />} />
                            <Route path="/videos" element={<VideoLibrary />} />
                            <Route path="/assets" element={<AssetRegister />} />
                            <Route path="/gis" element={<GISView />} />
                            <Route path="/ask-ai" element={<AskAI />} />
                            <Route path="/settings" element={<Settings />} />
                            <Route path="*" element={<NotFound />} />
                          </Routes>
                        </Layout>
                      </UploadProvider>
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </Suspense>
            </LabelMapProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
