import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Upload,
  FileVideo,
  Database,
  AlertTriangle,
  MessageSquare,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/roadsight-logo.jpg";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Anomaly Library", href: "/gis", icon: AlertTriangle },
  { name: "Asset Library", href: "/asset-library", icon: Database },
  { name: "Ask AI", href: "/ask-ai", icon: MessageSquare },
  { name: "Project Management", href: null, icon: null, isHeading: true },
  { name: "Road Register", href: "/roads", icon: Map },
  { name: "Survey Upload", href: "/upload", icon: Upload },
  { name: "Video Library", href: "/videos", icon: FileVideo },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen flex w-full bg-background overflow-hidden">
        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "h-screen flex flex-col transition-all duration-300",
            collapsed ? "w-[56px]" : "w-1/6 max-w-[400px]",
            "fixed lg:static top-0 left-0 z-[9999] lg:z-auto lg:transition-all",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
          style={{
            background: 'hsl(215 58% 30%)',
          }}
        >
          {/* Logo */}
          <div className={cn("flex items-center border-b border-white/[0.06] relative", collapsed ? "justify-center px-1 py-3" : "justify-center px-4 py-3")}>
            {collapsed ? (
              <img
                src={logo}
                alt="RoadSight AI"
                className="h-7 w-7 object-contain brightness-0 invert opacity-95 rounded"
              />
            ) : (
              <img
                src={logo}
                alt="RoadSight AI"
                className="h-10 w-auto object-contain brightness-0 invert opacity-95"
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-white/70 hover:text-white hover:bg-white/10 h-7 w-7 absolute right-3 top-1/2 -translate-y-1/2"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className={cn("flex-1 py-3 space-y-0.5 overflow-y-auto", collapsed ? "px-1" : "px-2.5")}>
            {navigation.map((item) => {
              if (item.isHeading) {
                if (collapsed) return <div key={item.name} className="my-2 mx-2 border-t border-white/[0.08]" />;
                return (
                  <div
                    key={item.name}
                    className="px-3 pt-5 pb-1.5 text-sm font-semibold text-white/25 uppercase tracking-[0.18em]"
                  >
                    {item.name}
                  </div>
                );
              }

              const isActive = location.pathname === item.href;
              const linkContent = (
                <Link
                  key={item.name}
                  to={item.href!}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "group flex items-center rounded-md transition-all duration-150",
                    collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-[7px]",
                    isActive
                      ? "bg-white/[0.1] text-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
                  )}
                >
                  <item.icon className={cn(
                    "flex-shrink-0 transition-colors",
                    collapsed ? "h-4 w-4" : "h-[15px] w-[15px]",
                    isActive ? "text-sky-400" : "text-white/30 group-hover:text-white/55"
                  )} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-xs font-medium">{item.name}</span>
                      {isActive && <div className="w-1 h-1 rounded-full bg-sky-400" />}
                    </>
                  )}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.name}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {item.name}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return linkContent;
            })}
          </nav>

          {/* Collapse toggle — desktop only */}
          <div className="hidden lg:flex justify-center py-1.5 border-t border-white/[0.06]">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(!collapsed)}
              className="h-7 w-7 text-white/30 hover:bg-white/[0.06] hover:text-white/60"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {/* User */}
          <div className={cn("border-t border-white/[0.06]", collapsed ? "p-1.5" : "p-2.5")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    <div className="w-8 h-8 rounded-md bg-gradient-to-br from-sky-500/20 to-blue-600/20 flex items-center justify-center ring-1 ring-white/[0.08] cursor-default">
                      <span className="text-white/75 font-semibold text-[10px]">
                        {user?.first_name?.[0]}{user?.last_name?.[0]}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {user?.first_name} {user?.last_name}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-sky-500/20 to-blue-600/20 flex items-center justify-center ring-1 ring-white/[0.08]">
                  <span className="text-white/75 font-semibold text-[10px]">
                    {user?.first_name?.[0]}{user?.last_name?.[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-white/70 truncate leading-tight">
                    {user?.first_name} {user?.last_name}
                  </p>
                  <p className="text-[9px] text-white/30 truncate">{user?.role}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="h-6 w-6 text-white/25 hover:bg-white/[0.06] hover:text-white/60"
                  title="Logout"
                >
                  <LogOut className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile header */}
          <header className="lg:hidden h-12 border-b border-border bg-card flex items-center px-4 gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <img
              src={logo}
              alt="RoadSight AI"
              className="h-5 w-auto object-contain dark:brightness-0 dark:invert"
            />
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
