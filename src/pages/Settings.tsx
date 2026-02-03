import { Card } from "@/components/ui/card";
import { Settings as SettingsIcon, User, Bell, Lock, Tag } from "lucide-react";
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

  const handleSave = () => {
    // Apply dark mode setting
    setTheme(darkMode ? "dark" : "light");

    toast({
      title: "Settings saved",
      description: "Your settings have been updated successfully.",
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and application preferences
        </p>
      </div>

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
                  <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization">Organization</Label>
                  <Input id="organization" value={organization} onChange={(e) => setOrganization(e.target.value)} />
                </div>
                {/* <Button onClick={handleSave} className="mt-4">Save Changes</Button> */}
              </div>
            </AccordionContent>
          </Card>
        </AccordionItem>

        <AccordionItem value="notifications" className="border-0">
          <Card className="card-shadow">
            <AccordionTrigger className="px-6 py-4 hover:no-underline">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 dark:text-foreground text-primary" />
                <div className="text-left">
                  <h2 className="font-semibold text-lg">Notifications</h2>
                  <p className="text-sm text-muted-foreground font-normal">
                    Configure notification preferences for surveys and processing
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <Separator className="mb-6" />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Survey Upload Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive notifications when survey uploads complete
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Processing Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Get alerts when AI processing finishes
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive email updates for important events
                    </p>
                  </div>
                  <Switch />
                </div>
                <Button onClick={handleSave} className="mt-4">Save Changes</Button>
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
                  <Input id="current-password" type="password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input id="new-password" type="password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input id="confirm-password" type="password" />
                </div>
                <div className="flex items-center justify-between pt-4">
                  <div className="space-y-0.5">
                    <Label>Two-Factor Authentication</Label>
                    <p className="text-sm text-muted-foreground">
                      Add an extra layer of security to your account
                    </p>
                  </div>
                  <Switch />
                </div>
                <Button onClick={handleSave} className="mt-4">Update Security</Button>
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
                    Configure upload speed, processing parameters, and display preferences
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <Separator className="mb-6" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="upload-speed">Upload Speed Limit (Mbps)</Label>
                  <Input id="upload-speed" type="number" defaultValue="100" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="processing-threads">Processing Threads</Label>
                  <Input id="processing-threads" type="number" defaultValue="4" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-Process Uploads</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically start AI processing after upload
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Dark Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable dark theme for the interface
                    </p>
                  </div>
                  <Switch checked={darkMode} onCheckedChange={setDarkMode} />
                </div>
                <Button onClick={handleSave} className="mt-4">Save Changes</Button>
              </div>
            </AccordionContent>
          </Card>
        </AccordionItem>

        <AccordionItem value="asset-labels" className="border-0">
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
        </AccordionItem>
      </Accordion>
    </div>
  );
}
