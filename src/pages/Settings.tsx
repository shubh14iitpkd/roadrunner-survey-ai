import { Card } from "@/components/ui/card";
import { Settings as SettingsIcon, User, Users, Lock, Tag, Eye, EyeOff, CheckCircle, XCircle, Shield } from "lucide-react";
import AssetLabelSettings from "@/components/settings/AssetLabelSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [darkMode, setDarkMode] = useState(resolvedTheme === "dark");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [wantsIcons, setWantsIcons] = useState(() => {
    const stored = localStorage.getItem('wants_icons');
    return stored === null ? false : stored === 'true';
  });

  useEffect(() => {
    if (user) {
      const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
      setFullName(name);
      setEmail(user.email || "");
      setOrganization(user.organisation || "");
    }
  }, [user]);

  useEffect(() => {
    setDarkMode(resolvedTheme === "dark");
  }, [resolvedTheme]);

  const handleToggleDarkMode = (checked: boolean) => {
    setDarkMode(checked);
    setTheme(checked ? "dark" : "light");
    toast({
      title: checked ? "Dark mode enabled" : "Light mode enabled",
      description: "Theme updated.",
    });
  };

  const handleToggleIcons = (checked: boolean) => {
    setWantsIcons(checked);
    localStorage.setItem('wants_icons', String(checked));
    toast({
      title: checked ? "Map icons enabled" : "Map icons disabled",
      description: "Map will update on next render.",
    });
  };

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your settings have been updated successfully.",
    });
  };

  // --- User Management (admin only) ---
  interface ManagedUser {
    _id: string;
    name: string;
    first_name: string;
    last_name: string;
    email: string;
    organisation: string;
    role: string;
    is_approved: boolean;
  }

  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [revokeDialog, setRevokeDialog] = useState<{ open: boolean; userId: string; name: string }>({ open: false, userId: "", name: "" });
  const [promoteDialog, setPromoteDialog] = useState<{ open: boolean; userId: string; name: string }>({ open: false, userId: "", name: "" });
  const [userSearch, setUserSearch] = useState("");

  const fetchUsers = useCallback(async () => {
    if (user?.role !== "Admin") return;
    setLoadingUsers(true);
    try {
      const resp = await api.user.list();
      // Sort: pending first, then by name
      const sorted = (resp.users as ManagedUser[]).sort((a, b) => {
        if (a.is_approved === b.is_approved) {
          const nameA = `${a.first_name} ${a.last_name}`.trim();
          const nameB = `${b.first_name} ${b.last_name}`.trim();
          return nameA.localeCompare(nameB);
        }
        return a.is_approved ? 1 : -1;
      });
      setManagedUsers(sorted);
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to load users.", variant: "destructive" });
    } finally {
      setLoadingUsers(false);
    }
  }, [user?.role]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleApprove = async (userId: string) => {
    setActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.user.approve(userId);
      toast({ title: "User approved" });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleRevoke = async (userId: string) => {
    setRevokeDialog({ open: false, userId: "", name: "" });
    setActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.user.revoke(userId);
      toast({ title: "User revoked" });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    // If promoting to Admin, require confirmation via dialog
    if (newRole === "Admin") {
      const u = managedUsers.find((u) => u._id === userId);
      const name = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email : userId;
      setPromoteDialog({ open: true, userId, name });
      return;
    }
    executeRoleChange(userId, newRole);
  };

  const executeRoleChange = async (userId: string, newRole: string) => {
    setPromoteDialog({ open: false, userId: "", name: "" });
    setActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.user.updateRole(userId, newRole);
      toast({ title: "Role updated" });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleUpdatePassword = async () => {
    if (!user?.id) return;
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: "Error",
        description: "All password fields are required.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match.",
        variant: "destructive",
      });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { api } = await import("@/lib/api");
      await api.user.updatePassword(user.id, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast({
        title: "Success",
        description: "Password updated successfully.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update password.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-header-strip">
        <div className="px-5 py-2 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">Configuration</p>
              <h1 className="text-sm font-bold text-foreground tracking-tight">Settings</h1>
            </div>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <Accordion type="single" collapsible className="space-y-4">
          <AccordionItem value="profile" className="border-0">
            <Card className="card-shadow">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 dark:text-foreground text-primary" />
                  <div className="text-left">
                    <h2 className="font-semibold text-lg">Profile Settings</h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      Update your profile information and preferences
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <Separator className="mb-6" />
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="organization">Organization</Label>
                    <Input id="organization" value={organization} onChange={(e) => setOrganization(e.target.value)} readOnly/>
                  </div>
                  {/* <Button onClick={handleSave} className="mt-4">Save Changes</Button> */}
                </div>
              </AccordionContent>
            </Card>
          </AccordionItem>
          <AccordionItem value="security" className="border-0">
            <Card className="card-shadow">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <Lock className="h-5 w-5 dark:text-foreground text-primary" />
                  <div className="text-left">
                    <h2 className="font-semibold text-lg">Security</h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      Manage password and security settings
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <Separator className="mb-6" />
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <div className="relative">
                      <Input
                        id="current-password"
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    onClick={handleUpdatePassword}
                    className="mt-4"
                    disabled={isUpdatingPassword}
                  >
                    {isUpdatingPassword ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </AccordionContent>
            </Card>
          </AccordionItem>

          <AccordionItem value="application" className="border-0">
            <Card className="card-shadow">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <SettingsIcon className="h-5 w-5 dark:text-foreground text-primary" />
                  <div className="text-left">
                    <h2 className="font-semibold text-lg">Application Settings</h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      Configure display preferences
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <Separator className="mb-6" />
                <div className="space-y-4">
                  {/* <div className="space-y-2">
                  <Label htmlFor="upload-speed">Upload Speed Limit (Mbps)</Label>
                  <Input id="upload-speed" type="number" defaultValue="100" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="processing-threads">Processing Threads</Label>
                  <Input id="processing-threads" type="number" defaultValue="4" />
                </div> */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Dark Mode</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable dark theme for the interface
                      </p>
                    </div>
                    <Switch checked={darkMode} onCheckedChange={handleToggleDarkMode} />
                  </div>
                  {user.role === "Admin" && <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Show Map Icons</Label>
                      <p className="text-sm text-muted-foreground">
                        Display asset-specific icons on the map instead of circles
                      </p>
                    </div>
                    <Switch checked={wantsIcons} onCheckedChange={handleToggleIcons} />
                  </div>}
                </div>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {user.role === "Admin" && <AccordionItem value="user-management" className="border-0">
            <Card className="card-shadow">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 dark:text-foreground text-primary" />
                  <div className="text-left">
                    <h2 className="font-semibold text-lg">User Management</h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      Approve, promote, or revoke user accounts
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <Separator className="mb-6" />
                <Input
                  placeholder="Search by name, email, or organisation..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="mb-4"
                />
                {loadingUsers ? (
                  <p className="text-sm text-muted-foreground">Loading users...</p>
                ) : managedUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No users found.</p>
                ) : (
                  <div className="relative space-y-3 max-h-[400px] overflow-y-auto overscroll-none pr-1">
                    {managedUsers.filter((u) => {
                      if (!userSearch.trim()) return true;
                      const q = userSearch.toLowerCase();
                      const fullName = `${u.first_name} ${u.last_name}`.toLowerCase();
                      return fullName.includes(q) || u.email.toLowerCase().includes(q) || (u.organisation || "").toLowerCase().includes(q);
                    }).map((u) => {
                      const isCurrentUser = u._id === user.id;
                      const displayName = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.name || u.email;
                      return (
                        <div
                          key={u._id}
                          className={`flex items-center justify-between gap-4 p-3 rounded-lg border ${
                            !u.is_approved ? "border-yellow-500/30 bg-yellow-500/5" : "border-border"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{displayName}</p>
                              {!u.is_approved && (
                                <Badge variant="outline" className="text-yellow-600 border-yellow-500/50 text-xs">
                                  Pending
                                </Badge>
                              )}
                              {isCurrentUser && (
                                <Badge variant="secondary" className="text-xs">You</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            {u.organisation && (
                              <p className="text-xs text-muted-foreground">{u.organisation}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!isCurrentUser && u.is_approved && u.role !== "Admin" ? (
                              <Select
                                value={u.role}
                                onValueChange={(value) => handleRoleChange(u._id, value)}
                                disabled={!!actionLoading[u._id]}
                              >
                                <SelectTrigger className="w-[150px] h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Admin">Admin</SelectItem>
                                  <SelectItem value="Road Surveyor">Road Surveyor</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="default" className="text-xs">
                                <Shield className="h-3 w-3 mr-1" />
                                {u.role}
                              </Badge>
                            )}

                            {!isCurrentUser && !u.is_approved && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs text-green-600 bg-green-400/10 border-green-500/50 hover:bg-green-500/10 hover:text-green-600 hover:border-green-700/70 hover:outline-2 hover:outline-green-700/70"
                                onClick={() => handleApprove(u._id)}
                                disabled={!!actionLoading[u._id]}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Approve
                              </Button>
                            )}

                            {!isCurrentUser && u.role !== "Admin" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs text-red-600 border-red-500/50 bg-red-600/20 hover:bg-red-700/20 hover:text-red-500 hover:border-red-700/70 hover:outline-2 hover:outline-red-700/70"
                                onClick={() => {
                                  const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
                                  setRevokeDialog({ open: true, userId: u._id, name });
                                }}
                                disabled={!!actionLoading[u._id]}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Revoke
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  <div className="pointer-events-none sticky bottom-0 h-6 w-full 
                    bg-gradient-to-b from-transparent to-black/20" />
                  </div>
                )}
              </AccordionContent>
            </Card>
          </AccordionItem>}

          {user.role === "Admin" && <AccordionItem value="asset-labels" className="border-0">
            <Card className="card-shadow">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <Tag className="h-5 w-5 dark:text-foreground text-primary" />
                  <div className="text-left">
                    <h2 className="font-semibold text-lg">Asset Labels</h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      Customize display names for asset types and categories.
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <Separator className="mb-6" />
                <AssetLabelSettings />
              </AccordionContent>
            </Card>
          </AccordionItem>}
        </Accordion>
      </div>

      {/* Promote to Admin confirmation dialog */}
      <AlertDialog open={promoteDialog.open} onOpenChange={(open) => !open && setPromoteDialog({ open: false, userId: "", name: "" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote to Admin?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to promote <span className="font-semibold text-foreground">{promoteDialog.name}</span> to Admin.
              This action is irreversible! Admin accounts cannot be demoted back to surveyor or revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => executeRoleChange(promoteDialog.userId, "Admin")}>
              Promote to Admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke account confirmation dialog */}
      <AlertDialog open={revokeDialog.open} onOpenChange={(open) => !open && setRevokeDialog({ open: false, userId: "", name: "" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Account?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete the account for <span className="font-semibold text-foreground">{revokeDialog.name}</span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => handleRevoke(revokeDialog.userId)}
            >
              Revoke Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
