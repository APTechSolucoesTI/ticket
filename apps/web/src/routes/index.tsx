import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Inbox, Clock, Users, FileText, Brain, Shield,
  CheckCircle2, Sparkles, Star, ArrowRight, ChevronRight,
  MessageCircle, Timer, BarChart3, Menu, Mail, MapPin,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "APTicket - Help Desk & PSA para MSPs" },
      {
        name: "description",
        content:
          "Centralize tickets de e-mail e WhatsApp, controle SLAs e registre horas por contrato. Help Desk + PSA para MSPs sérios.",
      },
      { property: "og:title", content: "APTicket - Help Desk & PSA para MSPs" },
      {
        property: "og:description",
        content: "Centralize tickets de e-mail e WhatsApp, controle SLAs e registre horas por contrato. Help Desk + PSA para MSPs sérios.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const NAV_LINKS = [
  { href: "#features", label: "Recursos" },
  { href: "#psa", label: "PSA" },
  { href: "#precos", label: "Preços" },
];

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-white/95 backdrop-blur shadow-md" : "bg-transparent"
      }`}
    >
      <nav aria-label="Menu principal" className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <BrandLogo
            variant={scrolled ? "light" : "dark"}
            className="size-10 drop-shadow-md"
          />
          <span className={`font-bold text-xl ${scrolled ? "text-primary" : "text-white"}`}>
            AP<span className={scrolled ? "text-gradient-primary" : "text-[#00C2CB]"}>Ticket</span>
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href}
               className={`text-sm font-medium transition-colors ${scrolled ? "text-foreground hover:text-secondary" : "text-white/90 hover:text-white"}`}>
              {l.label}
            </a>
          ))}
          <Link to="/kb"
             className={`text-sm font-medium transition-colors ${scrolled ? "text-foreground hover:text-secondary" : "text-white/90 hover:text-white"}`}>
            Base de Conhecimento
          </Link>
          <Link to="/portal"
             className={`text-sm font-medium transition-colors ${scrolled ? "text-foreground hover:text-secondary" : "text-white/90 hover:text-white"}`}>
            Portal do Cliente
          </Link>
          <Link to="/auth"
             className={`text-sm font-medium transition-colors ${scrolled ? "text-foreground hover:text-secondary" : "text-white/90 hover:text-white"}`}>
            Entrar
          </Link>
        </div>
        <Link to="/demo/Dashboard" className="hidden md:inline-flex items-center bg-accent text-primary font-semibold px-4 py-2 rounded-md hover:brightness-110 transition">
          Ver demonstração
        </Link>
        <button
          aria-label="Abrir menu" aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`md:hidden grid place-items-center min-h-11 min-w-11 rounded-md ${scrolled ? "text-primary" : "text-white"}`}
        >
          <Menu className="h-6 w-6" />
        </button>
      </nav>
      {open && (
        <div role="dialog" aria-modal="true" className="md:hidden bg-white border-t border-border shadow-lg">
          <div className="px-4 py-4 flex flex-col gap-3">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                 className="text-foreground font-medium py-3 min-h-11 flex items-center">{l.label}</a>
            ))}
            <Link to="/kb" onClick={() => setOpen(false)}
               className="text-foreground font-medium py-3 min-h-11 flex items-center">Base de Conhecimento</Link>
            <Link to="/auth" onClick={() => setOpen(false)}
               className="text-foreground font-medium py-3 min-h-11 flex items-center">Entrar</Link>
            <Link to="/portal" onClick={() => setOpen(false)}
               className="text-foreground font-medium py-3 min-h-11 flex items-center">Portal do Cliente</Link>
            <Link to="/demo/Dashboard" onClick={() => setOpen(false)}
               className="bg-accent text-primary font-semibold px-4 py-3 rounded-md text-center">
              Ver demonstração
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
function FooterCol({ title, links }: { title: string; links: { href: string; label: string; to?: string }[] }) {
  return (
    <div>
      <h4 className="font-bold text-sm uppercase tracking-wider text-white">{title}</h4>
      <ul className="mt-4 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.to ? (
              <Link to={l.to} className="text-sm text-white/70 hover:text-accent transition">{l.label}</Link>
            ) : (
              <a href={l.href} className="text-sm text-white/70 hover:text-accent transition">{l.label}</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-primary text-white" style={{ paddingTop: "clamp(2.5rem, 6vw, 4rem)", paddingBottom: "clamp(1.5rem, 3vw, 2rem)" }}>
      <div
        className="max-w-7xl mx-auto grid"
        style={{ paddingInline: "clamp(1rem, 4vw, 1.5rem)", gap: "clamp(2rem, 4vw, 2.5rem)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))" }}
      >
        <div>
          <div className="flex items-center gap-2.5">
            <BrandLogo variant="dark" className="size-11 drop-shadow-md" />
            <span className="font-bold text-xl">APTicket</span>
          </div>
          <p className="mt-4 text-sm text-white/70 leading-relaxed">
            APTicket é a plataforma de Help Desk e PSA para MSPs - tickets unificados, SLA rigoroso e franquia de horas por contrato.
          </p>
        </div>
        <FooterCol title="Produto" links={[
          { href: "#features", label: "Recursos" },
          { href: "#psa", label: "PSA & Contratos" },
          { href: "#precos", label: "Preços" },
          { href: "/portal", label: "Portal do Cliente", to: "/portal" },
        ]} />
        <FooterCol title="Empresa" links={[
          { href: "#features", label: "Por que APTicket" },
          { href: "/auth", label: "Entrar", to: "/auth" },
        ]} />
        <FooterCol title="Suporte" links={[
          { href: "/kb", label: "Base de Conhecimento", to: "/kb" },
          { href: "#faq", label: "Perguntas frequentes" },
        ]} />
      </div>
      <div
        className="max-w-7xl mx-auto mt-10 sm:mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-white/60"
        style={{ paddingInline: "clamp(1rem, 4vw, 1.5rem)" }}
      >
        <p>© {new Date().getFullYear()} APTech Soluções em TI - Americana/SP. Todos os direitos reservados.</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Brasil</span>
                <span className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0" />comercial@aptechinfo.com.br</span>
        </p>
      </div>
    </footer>
  );
}

const FEATURES = [
  { icon: Inbox,       t: "Inbox Unificado",         d: "E-mail e WhatsApp em uma fila única. Sem alt-tab, sem ticket perdido." },
  { icon: Timer,       t: "SLA Rigoroso",            d: "Cronômetros de resposta e resolução por prioridade e contrato, congelam ao resolver." },
  { icon: FileText,    t: "Contratos & Franquia",    d: "Horas contratadas x consumidas por cliente, com alertas de estouro." },
  { icon: Clock,       t: "Time Tracking",           d: "Cronômetro no ticket. Cada minuto vira histórico com técnico, início e fim." },
  { icon: Users,       t: "Portal do Cliente",       d: "Seus clientes abrem, acompanham e respondem tickets com anexos." },
  { icon: Shield,      t: "Multi-tenant seguro",     d: "Isolamento por tenant via RLS. Cada MSP com seus dados, sem vazamento." },
];

const STEPS = [
  { n: 1, t: "Cadastre seus clientes",  d: "Empresas, contatos e equipamentos importados via planilha ou CNPJ automático." },
  { n: 2, t: "Configure contratos & SLA", d: "Franquia de horas, prioridades e prazos de resposta/resolução por cliente." },
  { n: 3, t: "Conecte seus canais",     d: "IMAP para e-mail e portal público. Tickets caem direto na fila." },
  { n: 4, t: "Atenda com controle",     d: "Kanban, notas internas, apontamento de horas e SLA sempre visível." },
];

const TURBO = [
  "Kanban com drag-and-drop",
  "Notas internas invisíveis ao cliente",
  "Base de Conhecimento com anexos e links",
  "Equipamentos vinculados a tickets",
  "Máscaras de CNPJ e telefone + BrasilAPI",
  "Portal público de abertura de chamados",
  "Dashboard com KPIs e SLA em tempo real",
];

const PAINS = [
  "Ticket importante perdido no e-mail",
  "Contrato estourando horas sem ninguém ver",
  "SLA descoberto só quando o cliente reclama",
  "WhatsApp da equipe virou o help desk",
  "Sem histórico de quem atendeu o quê",
  "Faturamento por hora sem prova nenhuma",
];

const TESTIMONIALS = [
  { nome: "Rafael Mendes",  clinica: "TechServe MSP",         txt: "Parei de perder ticket no e-mail. SLA na tela o dia inteiro, ninguém mais deixa passar." },
  { nome: "Camila Torres",  clinica: "InfraCloud Suporte",    txt: "A franquia de horas por contrato me fez cobrar tudo que era pra cobrar. Pagou o sistema no 1º mês." },
  { nome: "Diego Alves",    clinica: "NOC Brasil",            txt: "Portal do cliente cortou 60% dos e-mails 'e o meu chamado?'. Time voltou a atender." },
];

const PLANOS = [
  { name: "Starter",      price: 149, items: ["Até 3 técnicos","Até 20 clientes","Inbox e-mail + portal","SLA e contratos","Suporte em horário comercial"] },
  { name: "Growth",       price: 349, items: ["Até 10 técnicos","Clientes ilimitados","WhatsApp + e-mail","Time tracking completo","Base de conhecimento","Dashboard avançado","Suporte prioritário"], featured: true },
  { name: "MSP Pro",      price: 699, items: ["Técnicos ilimitados","Multi-empresa","API + integrações","Onboarding dedicado","White-label","Gerente de conta"] },
];

const FAQ = [
  { q: "Preciso instalar algo?", a: "Não. O APTicket roda 100% na nuvem, com backup automático e acesso de qualquer navegador." },
  { q: "Meus dados ficam isolados dos outros MSPs?", a: "Sim. Arquitetura multi-tenant com Row-Level Security no banco. Cada tenant só vê o próprio dado." },
  { q: "Consigo importar meus clientes?", a: "Sim. Cadastro por CNPJ (BrasilAPI) e importação em massa via planilha para contatos e equipamentos." },
  { q: "Posso cancelar quando quiser?", a: "Sim. Sem fidelidade, sem multa. Cancele com 1 clique no painel." },
];

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen bg-[var(--surface,#F0F4F8)]">
      <Navbar />

      {/* HERO */}
      <section
        className="relative overflow-clip"
        style={{
          background: "linear-gradient(135deg,#0D2B5E 0%,#1A6B8A 60%,#00C2CB 100%)",
          paddingTop: "clamp(5rem, 9vw, 9rem)",
          paddingBottom: "clamp(3rem, 7vw, 7rem)",
        }}
      >
        <svg className="absolute inset-0 w-full h-full opacity-[0.06] pointer-events-none" aria-hidden="true">
          <defs>
            <pattern id="circuit" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M0 30 H60 M30 0 V60 M15 15 H45 V45 H15 Z" stroke="white" strokeWidth="1" fill="none" />
              <circle cx="30" cy="30" r="2" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#circuit)" />
        </svg>

        <div aria-hidden="true" className="hidden min-[480px]:block">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className={`absolute rounded-full bg-white/30 animate-pulse ${i > 3 ? "hidden sm:block" : ""}`}
              style={{
                width: 6 + (i % 3) * 4,
                height: 6 + (i % 3) * 4,
                top: `${10 + i * 11}%`,
                left: `${(i * 13 + 7) % 85}%`,
                animationDelay: `${i * 0.7}s`,
              }}
            />
          ))}
        </div>

        <div className="relative max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur text-white px-3 py-1.5 text-xs font-medium mb-6 animate-fade-in border border-white/20">
            <Sparkles className="size-3" /> HELP DESK + PSA PARA MSPs
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] animate-fade-in text-white">
            Todo ticket na fila.<br />
            <span className="bg-gradient-to-r from-[#00C2CB] to-white bg-clip-text text-transparent">Todo minuto contado.</span>
          </h1>
          <p className="text-lg md:text-xl text-white/85 mt-6 max-w-2xl mx-auto">
            Centralize tickets de e-mail e WhatsApp, controle SLAs por contrato e registre cada hora trabalhada - do primeiro chamado ao faturamento.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-9">
            <Button asChild size="lg" className="bg-[#00C2CB] text-[#0D2B5E] hover:brightness-110 h-12 px-6 text-base font-semibold shadow-lg shadow-black/20">
              <Link to="/demo/Dashboard">Ver demonstração ao vivo <ArrowRight className="size-4 ml-1" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base bg-transparent border-white/60 text-white hover:bg-white/10 hover:text-white">
              <Link to="/auth">Começar grátis</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base bg-transparent border-white/60 text-white hover:bg-white/10 hover:text-white">
              <Link to="/portal">Portal do Cliente</Link>
            </Button>
          </div>
          <p className="text-xs text-white/70 mt-5">Multi-tenant · SLA no relógio · Franquia de horas por contrato</p>
        </div>

        {/* Stats */}
        <div className="relative mt-16 bg-white/5 backdrop-blur border-y border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              ["100%", "tickets numa fila só"],
              ["-40%", "de SLA estourado"],
              ["2h", "economizadas por técnico/dia"],
              ["24/7", "portal do cliente disponível"],
            ].map(([n, l]) => (
              <div key={l}>
                <div className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-[#00C2CB] to-white bg-clip-text text-transparent">{n}</div>
                <div className="text-xs md:text-sm text-white/70 mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PAINS */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold">Seu MSP ainda opera assim?</h2>
          <p className="text-muted-foreground mt-3">Se qualquer uma dessas cenas te lembra a semana passada, o APTicket resolve.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          {PAINS.map((p) => (
            <div key={p} className="flex gap-3 items-start p-5 rounded-xl bg-card border shadow-card">
              <div className="size-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                <span className="text-destructive font-bold">✕</span>
              </div>
              <span className="text-sm font-medium pt-1">{p}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium mb-3">RECURSOS</div>
          <h2 className="text-3xl md:text-4xl font-bold">Tudo que um Help Desk sério precisa</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <Card key={f.t} className="border-0 shadow-card shadow-card-hover">
              <CardContent className="p-6">
                <div className="size-12 rounded-xl gradient-primary flex items-center justify-center shadow-premium mb-4">
                  <f.icon className="size-6 text-white" />
                </div>
                <h3 className="font-bold text-lg">{f.t}</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{f.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* TURBO SECTION */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-800 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/20 text-accent px-3 py-1 text-xs font-medium mb-4">SETUP</div>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">Configure em 4 passos. <span className="text-gradient-primary">Coloque no ar em 1 dia.</span></h2>
            <div className="mt-8 space-y-5">
              {STEPS.map((s) => (
                <div key={s.n} className="flex gap-4">
                  <div className="size-10 rounded-lg gradient-primary flex items-center justify-center font-bold shrink-0">{s.n}</div>
                  <div>
                    <div className="font-semibold">{s.t}</div>
                    <div className="text-sm text-white/70 mt-0.5">{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white/5 backdrop-blur rounded-2xl p-7 border border-white/10">
            <div className="text-xs font-medium text-accent mb-3">INCLUSO EM TODOS OS PLANOS</div>
            <ul className="space-y-3">
              {TURBO.map((t) => (
                <li key={t} className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="size-5 text-accent shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* PSA / SLA */}
      <section id="psa" className="bg-primary/5 py-20">
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/15 text-primary px-3 py-1 text-xs font-medium mb-4">
              <Brain className="size-3" /> PSA & CONTRATOS
            </div>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">Do <span className="text-gradient-primary">chamado</span> ao <span className="text-gradient-primary">faturamento</span>, sem planilha</h2>
            <p className="text-muted-foreground mt-4 leading-relaxed">
              Cada ticket sabe a qual contrato pertence. Cada minuto do cronômetro debita da franquia. No fim do mês, o relatório de horas está pronto - com técnico, data e ticket.
            </p>
            <Button asChild size="lg" className="gradient-primary text-white shadow-premium mt-6">
              <Link to="/auth">Testar agora <ArrowRight className="size-4 ml-1" /></Link>
            </Button>
          </div>
          <div className="space-y-3">
            {[
              { icon: Timer,       color: "text-amber-500 bg-amber-50",   t: "SLA de resolução em risco",       c: "3 tickets",  a: "Priorizar agora" },
              { icon: BarChart3,   color: "text-sky-500 bg-sky-50",       t: "Contrato TechServe: 82% consumido", c: "18h restantes", a: "Alerta de estouro" },
              { icon: MessageCircle, color: "text-emerald-500 bg-emerald-50", t: "5 chamados novos do portal hoje", c: "aguardando", a: "Distribuir na fila" },
            ].map((it) => (
              <Card key={it.t} className="border-0 shadow-card shadow-card-hover">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`size-12 rounded-xl flex items-center justify-center ${it.color}`}>
                    <it.icon className="size-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{it.t}</div>
                    <div className="text-xs text-emerald-600 font-bold mt-0.5">{it.c}</div>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold">MSPs que já vivem no APTicket</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t) => (
            <Card key={t.nome} className="border-0 shadow-card">
              <CardContent className="p-6">
                <div className="flex text-amber-400 mb-3">{[1,2,3,4,5].map((i)=>(<Star key={i} className="size-4 fill-current" />))}</div>
                <p className="text-sm leading-relaxed">"{t.txt}"</p>
                <div className="mt-5 pt-5 border-t flex items-center gap-3">
                  <div className="size-10 rounded-full gradient-primary flex items-center justify-center text-white font-bold text-sm">
                    {t.nome.split(" ")[0]?.[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{t.nome}</div>
                    <div className="text-xs text-muted-foreground">{t.clinica}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="precos" className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium mb-3">PLANOS</div>
          <h2 className="text-3xl md:text-4xl font-bold">Escolha o plano do seu MSP</h2>
          <p className="text-muted-foreground mt-3">Sem fidelidade. Cancele quando quiser.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {PLANOS.map((p) => (
            <Card key={p.name} className={p.featured ? "border-0 gradient-primary text-white shadow-premium scale-105 relative" : "border-0 shadow-card"}>
              {p.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-primary text-xs font-bold px-3 py-1 rounded-full shadow">MAIS POPULAR</div>
              )}
              <CardContent className="p-7">
                <div className={`text-sm font-bold uppercase tracking-wide ${p.featured ? "text-white/80" : "text-muted-foreground"}`}>{p.name}</div>
                <div className="text-5xl font-extrabold mt-2">R${p.price}<span className={`text-base font-normal ${p.featured ? "text-white/80" : "text-muted-foreground"}`}>/mês</span></div>
                <ul className="mt-6 space-y-3 text-sm">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2"><CheckCircle2 className={`size-4 mt-0.5 shrink-0 ${p.featured ? "text-white" : "text-primary"}`} />{i}</li>
                  ))}
                </ul>
                <Button asChild className={`w-full mt-7 ${p.featured ? "bg-white text-primary hover:bg-white/90" : "gradient-primary text-white"}`}>
                  <Link to="/auth">Começar agora</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-4 py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-10">Perguntas frequentes</h2>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-xl border bg-card shadow-card overflow-hidden">
              <summary className="cursor-pointer p-5 font-semibold flex items-center justify-between hover:bg-muted/30">
                {f.q}
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
              </summary>
              <p className="px-5 pb-5 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="bg-slate-900 text-white py-20">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <BrandLogo variant="dark" className="mx-auto mb-5 size-16 drop-shadow-lg" />
          <h2 className="text-3xl md:text-5xl font-extrabold">Pronto pra tirar seu MSP da bagunça?</h2>
          <p className="text-white/70 mt-4 text-lg">Comece grátis hoje. Configure em minutos. Tenha SLA e horas sob controle desde o primeiro ticket.</p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Button asChild size="lg" className="gradient-primary text-white shadow-premium h-12 px-7 text-base">
              <Link to="/auth">Começar grátis</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 h-12 px-7 text-base">
              <Link to="/portal">Ver Portal do Cliente</Link>
            </Button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
