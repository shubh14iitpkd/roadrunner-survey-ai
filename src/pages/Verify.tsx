import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/roadsight-logo.jpg";

export default function Verify() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get("userId");
  const { verifyCode } = useAuth();
  const { toast } = useToast();
  
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Invalid verification link",
      });
      navigate("/signup");
      return;
    }

    if (code.length !== 6) {
      toast({
        variant: "destructive",
        title: "Invalid code",
        description: "Please enter a 6-digit code",
      });
      return;
    }

    setLoading(true);
    const result = await verifyCode(userId, code);
    setLoading(false);

    if (result.success) {
      toast({
        title: "Success!",
        description: "Your account has been verified",
      });
      navigate("/");
    } else {
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: "Invalid verification code. Try 123456",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 card-shadow">
        <div className="flex justify-center mb-6">
          <img src={logo} alt="RoadSight AI" className="h-16 w-auto object-contain" />
        </div>
        
        <h1 className="text-2xl font-bold text-center mb-2">Verify Your Email</h1>
        <p className="text-muted-foreground text-center mb-6">
          A verification code has been sent to your email. Enter the code to verify.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Verification Code</Label>
            <Input
              id="code"
              type="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="text-center text-2xl tracking-widest"
              required
            />
            <p className="text-xs text-muted-foreground text-center">
              For demo purposes, use code: 123456
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verifying..." : "Verify & Continue"}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/login")}>
            Back to Login
          </Button>
        </div>
      </Card>
    </div>
  );
}
