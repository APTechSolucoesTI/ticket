import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Ticket } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { setToken } from "@/lib/session";
import {
  login,
  acceptInvite,
  requestPasswordReset,
  resetPassword,
  signUpTenant,
} from "@/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — APTicket" },
      { name: "description", content: "Acesse sua conta APTicket — Help Desk e PSA para MSPs." },
    ],
  }),
  component: AuthPage,
});

// Token da autenticação própria do APTicket, vem como query string
// (?invite=<token>/?reset=<token>) — o próprio server (auth.functions.ts/
// users.functions.ts) que montou o link. Fase 2 concluída (todo usuário
// legado migrado) — fallback de hash antigo do GoTrue (#type=invite/
// recovery) removido, não tem mais nenhum link desses em circulação.
type AuthAction = "own-invite" | "own-reset" | null;

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSending, setForgotSending] = useState(false);

  // Query string (?invite=/?reset=) nunca chega no servidor durante o SSR
  // inicial nesse sentido de decisão de UI — não dá pra ler num
  // inicializador de useState sem arriscar mismatch de hidratação, então
  // fica em useEffect (roda só depois de montar, server e client renderizam
  // igual no primeiro paint). `checkedHash` evita a corrida: o efeito de
  // redirect só decide depois que este aqui já rodou, nunca antes.
  const [authAction, setAuthAction] = useState<AuthAction>(null);
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [checkedHash, setCheckedHash] = useState(false);
  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    const invite = params.get("invite");
    const reset = params.get("reset");
    if (invite) {
      setAuthAction("own-invite");
      setActionToken(invite);
    } else if (reset) {
      setAuthAction("own-reset");
      setActionToken(reset);
    }
    setCheckedHash(true);
  }, []);

  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSettingPassword(true);
    try {
      if (!actionToken) throw new Error("Link inválido.");
      const fn = authAction === "own-invite" ? acceptInvite : resetPassword;
      const { token } = await fn({ data: { token: actionToken, password: newPassword } });
      setToken(token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível definir a senha.");
      setSettingPassword(false);
      return;
    }
    setSettingPassword(false);
    toast.success("Senha definida! Bem-vindo ao APTicket.");
    window.history.replaceState(null, "", window.location.pathname);
    navigate({ to: "/dashboard", replace: true });
  };

  useEffect(() => {
    if (!authLoading && checkedHash && session && !authAction) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [authLoading, checkedHash, session, authAction, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { token } = await login({ data: { email, password } });
      setToken(token);
      toast.success("Bem-vindo de volta!");
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "E-mail ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotSending(true);
    try {
      await requestPasswordReset({ data: { email: forgotEmail } });
      toast.success("Se o e-mail existir, enviamos um link de redefinição.");
      setForgotOpen(false);
      setForgotEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível solicitar a redefinição.");
    } finally {
      setForgotSending(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !name.trim()) {
      toast.error("Preencha o nome e a empresa");
      return;
    }
    setLoading(true);
    try {
      const { token } = await signUpTenant({ data: { name, company, email, password } });
      setToken(token);
      toast.success("Conta criada! Bem-vindo ao APTicket.");
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a conta.");
    } finally {
      setLoading(false);
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
          {authAction ? (
            <form onSubmit={handleSetPassword} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {authAction === "own-invite" ? "Bem-vindo(a) ao APTicket" : "Redefinir senha"}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {authAction === "own-invite"
                    ? "Defina uma senha de acesso pra concluir seu cadastro."
                    : "Escolha uma nova senha pra sua conta."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-pass">Nova senha</Label>
                <Input
                  id="np-pass"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-pass-confirm">Confirmar senha</Label>
                <Input
                  id="np-pass-confirm"
                  type="password"
                  required
                  minLength={8}
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={settingPassword}>
                {settingPassword ? "Salvando…" : "Definir senha e entrar"}
              </Button>
            </form>
          ) : forgotOpen ? (
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Esqueci minha senha</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Informe seu e-mail — se existir uma conta, enviamos um link de redefinição.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-email">E-mail</Label>
                <Input
                  id="fp-email"
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={forgotSending}>
                {forgotSending ? "Enviando…" : "Enviar link de redefinição"}
              </Button>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="text-xs text-muted-foreground hover:underline w-full text-center"
              >
                ← Voltar
              </button>
            </form>
          ) : (
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-3 pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="si-email">E-mail</Label>
                    <Input
                      id="si-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="si-pass">Senha</Label>
                    <Input
                      id="si-pass"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Entrando…" : "Entrar"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-xs text-muted-foreground hover:underline w-full text-center"
                  >
                    Esqueci minha senha
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-3 pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="su-name">Seu nome</Label>
                    <Input
                      id="su-name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-company">Empresa (MSP)</Label>
                    <Input
                      id="su-company"
                      required
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Ex: AP Tech Suporte"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-email">E-mail</Label>
                    <Input
                      id="su-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-pass">Senha</Label>
                    <Input
                      id="su-pass"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
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
          )}
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
