'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* Login "Barras como arte": as barras do logo grandes no alto, em vidro (duas
   foscas, uma sólida), a frase na frente, o nome Vetra embaixo e o formulário
   numa folha. Mostrar senha, autocompletar do iPhone e erros em português. */

/** Erros do Supabase Auth em português; o resto vira mensagem genérica. */
function authError(message: string) {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials'))
    return 'E-mail ou senha incorretos.';
  if (text.includes('email not confirmed'))
    return 'Confirme o seu e-mail antes de entrar.';
  if (text.includes('already registered') || text.includes('already exists'))
    return 'Já existe uma conta com esse e-mail. Entre com ela.';
  if (text.includes('password should be at least'))
    return 'A senha precisa de pelo menos 6 caracteres.';
  if (text.includes('rate limit') || text.includes('too many'))
    return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  if (text.includes('network') || text.includes('fetch'))
    return 'Sem conexão. Confira a internet e tente de novo.';
  return 'Não foi possível entrar agora. Tente de novo.';
}

export default function AuthPage() {
  // Protótipo: já vem preenchido e aceita qualquer e-mail e senha.
  const [email, setEmail] = useState('voce@vetra.app');
  const [password, setPassword] = useState('vetra-demo');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    const supabase = createClient();
    const result =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) return setMessage(authError(result.error.message));
    if (mode === 'signup' && !result.data.session)
      return setMessage('Conta criada. Confirme o e-mail e depois entre.');
    window.location.replace('/');
  }
  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-background text-foreground">
      {/* Medidas fixas da prévia aprovada (barras 70px de largura, 120/190/260 de
          altura, 16px de espaço, frase em 30px a 300px do topo). Nada escala: quem
          aperta é a folha. A área segura do topo desce tudo junto. */}
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[calc(env(safe-area-inset-top)+40px)] -right-[30px] flex items-end gap-4"
        >
          <span className="block h-[120px] w-[70px] rounded-[22px] border border-foreground/[0.14] bg-foreground/[0.08]" />
          <span className="block h-[190px] w-[70px] rounded-[22px] border border-foreground/[0.16] bg-foreground/[0.1]" />
          <span className="block h-[260px] w-[70px] rounded-[22px] bg-linear-to-b from-foreground to-foreground/85" />
        </div>
        {/* Placa de vidro fosco à frente do fundo: barras vistas através dela,
            frase e formulário nítidos por cima. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-50vw] top-0 h-[calc(env(safe-area-inset-top)+340px)] bg-linear-to-b from-white/[0.06] via-white/[0.02] to-transparent backdrop-blur-[6px] backdrop-saturate-150"
        />
        <div className="relative px-6 pt-[calc(env(safe-area-inset-top)+234px)]">
          <h1 className="relative text-[30px] leading-[1.1] font-semibold tracking-[-0.03em]">
            Seu dinheiro,
            <br />
            visto por inteiro.
          </h1>
          <p className="relative mt-3 text-xl font-semibold tracking-[-0.04em]">
            Vetra
          </p>
        </div>
      </div>

      {/* Formulário num card logo abaixo do nome, com 16px de margem no celular. */}
      {/* No Safari a barra de endereço flutuante cobre a base: espaço extra embaixo. */}
      <section className="relative mx-4 mt-8 mb-[max(1rem,env(safe-area-inset-bottom))] rounded-[28px] border bg-card px-6 pt-6 pb-7 max-md:[@media(display-mode:browser)]:mb-24 sm:mx-auto sm:w-full sm:max-w-md md:mt-10 md:mb-10">
        <h2 className="sr-only">
          {mode === 'login' ? 'Entrar' : 'Criar sua conta'}
        </h2>
        <form className="grid gap-3.5" onSubmit={submit}>
          <div className="grid gap-1.5">
            <label htmlFor="auth-email" className="text-[13px] font-medium">
              E-mail
            </label>
            <Input
              type="email"
              id="auth-email"
              name="email"
              autoComplete={mode === 'login' ? 'username' : 'email'}
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="voce@email.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 rounded-2xl px-4 text-base"
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="auth-password" className="text-[13px] font-medium">
              Senha
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                id="auth-password"
                name="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-2xl px-4 pr-12 text-base"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
                aria-label={
                  showPassword ? 'Esconder a senha' : 'Mostrar a senha'
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          {message && (
            <p role="alert" className="rounded-2xl bg-muted p-3 text-sm">
              {message}
            </p>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="h-[50px] rounded-full text-base"
          >
            {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </Button>
        </form>
        <p className="mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
          Protótipo com dados fictícios: qualquer e-mail e senha entram. Nada é
          salvo nem enviado.
        </p>
        <p className="mt-3.5 text-center text-sm text-muted-foreground">
          {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem uma conta?'}{' '}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setMessage('');
            }}
          >
            {mode === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
      </section>
    </main>
  );
}
