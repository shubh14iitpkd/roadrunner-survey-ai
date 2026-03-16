import { Card } from "@/components/ui/card";
import { Settings as SettingsIcon, User, Bell, Lock, Tag, Eye, EyeOff } from "lucide-react";
import AssetLabelSettings from "@/components/settings/AssetLabelSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

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
                  {user.role=="Admin" && <div className="flex items-center justify-between">
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

          {user.role=="Admin" && <AccordionItem value="asset-labels" className="border-0">
            <Card className="card-shadow">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <Tag className="h-5 w-5 dark:text-foreground text-primary" />
                  <div className="text-left">
                    <h2 className="font-semibold text-lg">Asset Labels</h2>
                    <p className="text-sm text-muted-foreground font-normal">
                      Customize display names for assets and categories
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
    </div>
  );
}
