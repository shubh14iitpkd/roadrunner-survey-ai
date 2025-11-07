import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/roadsight-logo.jpg";

export default function SignUp() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    organisation: "",
    password: "",
    role: "" as "Road Surveyor" | "Asset Manager" | "Admin" | "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.first_name || !formData.last_name || !formData.email || 
        !formData.organisation || !formData.password || !formData.role) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Please fill in all fields",
      });
      return;
    }

    setLoading(true);
    
    const result = await signUp({
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email,
      organisation: formData.organisation,
      role: formData.role,
    });

    setLoading(false);

    if (result.success && result.userId) {
      navigate(`/verify?userId=${result.userId}`);
    } else {
      toast({
        variant: "destructive",
        title: "Sign up failed",
        description: "This email is already registered",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 card-shadow">
        <div className="flex justify-center mb-6">
          <img src={logo} alt="RoadSight AI" className="h-16 w-auto object-contain" />
        </div>
        
        <h1 className="text-2xl font-bold text-center mb-2">Create Account</h1>
        <p className="text-muted-foreground text-center mb-6">
          Sign up to get started with RoadSight AI
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="organisation">Organisation</Label>
            <Input
              id="organisation"
              value={formData.organisation}
              onChange={(e) => setFormData({ ...formData, organisation: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.role}
              onValueChange={(value) => setFormData({ ...formData, role: value as any })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select your role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Road Surveyor">Road Surveyor</SelectItem>
                <SelectItem value="Asset Manager">Asset Manager</SelectItem>
                <SelectItem value="Admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Sign Up"}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          Already have an account?{" "}
          <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/login")}>
            Login
          </Button>
        </div>
      </Card>
    </div>
  );
}
