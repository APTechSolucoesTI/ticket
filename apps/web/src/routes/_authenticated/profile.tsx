import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/empty-stub";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { maskPhone, normalizePhone } from "@/lib/masks";
import { changeMyPassword, getMyProfile, updateMyContact } from "@/lib/profile.functions";
import { setToken } from "@/lib/session";
import { getUserFacingError } from "@/lib/user-facing-error";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

const contactSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido.").max(255),
  phone: z
    .string()
    .trim()
    .refine((value) => !value || normalizePhone(value).length >= 12, "Informe telefone e DDD."),
  currentPassword: z.string().max(200),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe sua senha atual."),
    newPassword: z.string().min(8, "Use pelo menos 8 caracteres.").max(200),
    confirmPassword: z.string().min(1, "Confirme a nova senha."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  });

type ContactForm = z.infer<typeof contactSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const getProfile = useServerFn(getMyProfile);
  const saveContact = useServerFn(updateMyContact);
  const savePassword = useServerFn(changeMyPassword);
  const [showPasswords, setShowPasswords] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getProfile(),
  });

  const contactForm = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: { email: "", phone: "", currentPassword: "" },
  });
  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    contactForm.reset({
      email: profileQuery.data.email,
      phone: profileQuery.data.phone ? maskPhone(profileQuery.data.phone) : "",
      currentPassword: "",
    });
  }, [contactForm, profileQuery.data]);

  const emailChanged =
    contactForm.watch("email").trim().toLowerCase() !==
    (profileQuery.data?.email.toLowerCase() ?? "");

  const contactMutation = useMutation({
    mutationFn: (values: ContactForm) => saveContact({ data: values }),
    onSuccess: async (result) => {
      if (result.token) setToken(result.token);
      queryClient.setQueryData(["my-profile"], result.profile);
      contactForm.reset({
        email: result.profile.email,
        phone: result.profile.phone ? maskPhone(result.profile.phone) : "",
        currentPassword: "",
      });
      toast.success(
        result.emailChanged
          ? "E-mail atualizado e sessão renovada."
          : "Dados de contato atualizados.",
      );
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível atualizar seu perfil.")),
  });

  const passwordMutation = useMutation({
    mutationFn: (values: PasswordForm) => savePassword({ data: values }),
    onSuccess: () => {
      passwordForm.reset();
      setShowPasswords(false);
      toast.success("Senha alterada com segurança.");
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível alterar sua senha.")),
  });

  const profile = profileQuery.data;
  const initials = useMemo(
    () =>
      (profile?.name ?? user?.name ?? "U")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join(""),
    [profile?.name, user?.name],
  );

  if (profileQuery.isLoading) return <ProfileSkeleton />;

  if (profileQuery.isError || !profile) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
        <PageHeader
          title="Meu perfil"
          subtitle="Gerencie seus dados de contato e a segurança da conta."
          icon={UserRound}
        />
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-start gap-3 p-5">
            <p className="text-sm text-destructive">Não foi possível carregar seu perfil.</p>
            <Button variant="outline" size="sm" onClick={() => void profileQuery.refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Meu perfil"
        subtitle="Gerencie seus dados de contato e a segurança da conta."
        icon={UserRound}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="overflow-hidden lg:sticky lg:top-24">
          <div className="h-20 bg-gradient-to-r from-primary/20 via-primary/10 to-cyan-400/10" />
          <CardContent className="-mt-10 p-5 pt-0">
            <Avatar className="size-20 border-4 border-card shadow-sm">
              <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <h2 className="mt-4 truncate text-base font-semibold">{profile.name}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{profile.email}</p>
            <div className="mt-5 space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="size-3.5" aria-hidden="true" />
                <span className="truncate">{profile.email}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="size-3.5" aria-hidden="true" />
                <span>
                  {profile.phone ? `+${maskPhone(profile.phone)}` : "Telefone não informado"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-sky-500/10 p-2 text-sky-600 dark:text-sky-300">
                  <Mail className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle className="text-base">Dados de contato</CardTitle>
                  <CardDescription className="mt-1">
                    Atualize o e-mail usado no acesso e seu telefone pessoal.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Form {...contactForm}>
                <form
                  className="space-y-4"
                  onSubmit={contactForm.handleSubmit((values) => {
                    if (emailChanged && !values.currentPassword) {
                      contactForm.setError("currentPassword", {
                        message: "Informe sua senha atual para alterar o e-mail.",
                      });
                      return;
                    }
                    contactMutation.mutate(values);
                  })}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={contactForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>E-mail</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={contactForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telefone</FormLabel>
                          <FormControl>
                            <Input
                              inputMode="tel"
                              autoComplete="tel"
                              placeholder="55 11 99999-9999"
                              {...field}
                              onChange={(event) => field.onChange(maskPhone(event.target.value))}
                            />
                          </FormControl>
                          <FormDescription>Informe DDD e número.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {emailChanged ? (
                    <FormField
                      control={contactForm.control}
                      name="currentPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha atual para confirmar o novo e-mail</FormLabel>
                          <FormControl>
                            <Input type="password" autoComplete="current-password" {...field} />
                          </FormControl>
                          <FormDescription>
                            Esta confirmação protege sua identidade de acesso.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}

                  <div className="flex justify-end border-t pt-4">
                    <Button type="submit" disabled={contactMutation.isPending}>
                      {contactMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      Salvar dados
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-300">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle className="text-base">Segurança</CardTitle>
                  <CardDescription className="mt-1">
                    Use uma senha exclusiva com pelo menos oito caracteres.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <KeyRound className="size-4" />
                <AlertTitle>Confirmação obrigatória</AlertTitle>
                <AlertDescription>
                  Para alterar a senha, confirme primeiro sua senha atual.
                </AlertDescription>
              </Alert>

              <Form {...passwordForm}>
                <form
                  className="space-y-4"
                  onSubmit={passwordForm.handleSubmit((values) => passwordMutation.mutate(values))}
                >
                  {(["currentPassword", "newPassword", "confirmPassword"] as const).map((name) => (
                    <FormField
                      key={name}
                      control={passwordForm.control}
                      name={name}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {name === "currentPassword"
                              ? "Senha atual"
                              : name === "newPassword"
                                ? "Nova senha"
                                : "Confirmar nova senha"}
                          </FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                type={showPasswords ? "text" : "password"}
                                autoComplete={
                                  name === "currentPassword" ? "current-password" : "new-password"
                                }
                                className="pr-10"
                                {...field}
                              />
                            </FormControl>
                            <button
                              type="button"
                              className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              onClick={() => setShowPasswords((visible) => !visible)}
                              aria-label={showPasswords ? "Ocultar senhas" : "Mostrar senhas"}
                            >
                              {showPasswords ? (
                                <EyeOff className="size-4" />
                              ) : (
                                <Eye className="size-4" />
                              )}
                            </button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                  <div className="flex justify-end border-t pt-4">
                    <Button type="submit" disabled={passwordMutation.isPending}>
                      {passwordMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                      Alterar senha
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6" aria-label="Carregando perfil">
      <Skeleton className="h-[76px] w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className="h-72 rounded-xl" />
        <div className="space-y-5">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      </div>
    </div>
  );
}
