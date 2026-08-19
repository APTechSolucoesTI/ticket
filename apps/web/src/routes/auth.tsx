import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Ticket } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — APTicket" },
      { name: "description", content: "Acesse sua conta APTicket — Help Desk e PSA para MSPs." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && session) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [authLoading, session, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Bem-vindo de volta!");
      navigate({ to: "/dashboard", replace: true });
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !name.trim()) {
      toast.error("Preencha o nome e a empresa");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        // "app: apticket" é o que o trigger apticket.handle_new_user() checa
        // antes de provisionar tenant — esse Supabase Auth é compartilhado
        // com outro sistema (mesma base de auth.users), sem esse marcador
        // qualquer conta criada em QUALQUER app que usa esse Supabase ganhava
        // de graça um tenant+perfil admin aqui.
        data: { name, company_name: company, app: "apticket" },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Conta criada! Você já pode entrar.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
            <Ticket className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">APTicket</h1>
          <p className="text-xs text-muted-foreground">Help Desk & PSA para MSPs</p>
        </div>

        <Card className="p-6">
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="si-email">E-mail</Label>
                  <Input id="si-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="si-pass">Senha</Label>
                  <Input id="si-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Entrando…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="su-name">Seu nome</Label>
                  <Input id="su-name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-company">Empresa (MSP)</Label>
                  <Input id="su-company" required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Ex: AP Tech Suporte" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email">E-mail</Label>
                  <Input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass">Senha</Label>
                  <Input id="su-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Criando…" : "Criar conta"}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Ao criar uma conta, um workspace exclusivo é provisionado para sua empresa.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </Card>

        <div className="text-center mt-4">
          <Link to="/" className="text-xs text-muted-foreground hover:underline">
            ← Voltar ao site
          </Link>
        </div>
      </div>
    </div>
  );
}
