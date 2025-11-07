import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/roadsight-logo.jpg";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { toast } = useToast();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in",
      });
      navigate("/");
    } else {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: result.error || "Invalid credentials",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 card-shadow">
        <div className="flex justify-center mb-6">
          <img src={logo} alt="RoadSight AI" className="h-16 w-auto object-contain" />
        </div>
        
        <h1 className="text-2xl font-bold text-center mb-2">Welcome Back</h1>
        <p className="text-muted-foreground text-center mb-6">
          Login to access your RoadSight AI dashboard
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end">
            <Button 
              variant="link" 
              className="p-0 h-auto text-sm"
              type="button"
              onClick={() => {
                toast({
                  title: "Feature not available",
                  description: "Password reset will be implemented in a future release",
                });
              }}
            >
              Forgot password?
            </Button>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          Don't have an account?{" "}
          <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/signup")}>
            Sign up
          </Button>
        </div>

        <div className="mt-4 p-3 bg-muted rounded-lg text-xs text-center text-muted-foreground">
          Demo: Use password "demo123" for any registered account
        </div>
      </Card>
    </div>
  );
}
