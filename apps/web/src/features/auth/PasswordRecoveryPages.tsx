import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api';
import { AuthShell, FormAlert } from './AuthShell';

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: (email: string) => api.post<{ message: string }>('/auth/forgot-password', { email }),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await mutation.mutateAsync(String(data.get('email') ?? ''));
    } catch {
      // Silencio proposital: a tela de sucesso e a mesma exista ou nao o
      // email. Diferenciar as respostas entregaria quais contas existem.
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell
        title="Confira seu e-mail"
        subtitle="Se este e-mail estiver cadastrado, enviaremos as instruções de recuperação em instantes."
        footer={
          <Link
            to="/entrar"
            className="font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
          >
            Voltar para o login
          </Link>
        }
      >
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />
          <p className="text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">
            O link de recuperacao expira em 1 hora. Se nao chegar, verifique a caixa de spam ou
            tente novamente.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Informe o e-mail cadastrado e enviaremos um link para criar uma nova senha."
      footer={
        <Link
          to="/entrar"
          className="font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
        >
          Voltar para o login
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@seupetshop.com.br"
          required
          autoFocus
        />
        <Button type="submit" size="lg" loading={mutation.isPending} className="w-full">
          Enviar link de recuperacao
        </Button>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { token: string; password: string; passwordConfirmation: string }) =>
      api.post<{ message: string }>('/auth/reset-password', input),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    try {
      await mutation.mutateAsync({
        token,
        password: String(data.get('password') ?? ''),
        passwordConfirmation: String(data.get('passwordConfirmation') ?? ''),
      });
      navigate('/entrar', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Nao foi possivel redefinir a senha. Tente novamente.',
      );
    }
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  if (!token) {
    return (
      <AuthShell
        title="Link inválido"
        subtitle="Este link de recuperação está incompleto ou expirou."
        footer={
          <Link
            to="/esqueci-senha"
            className="font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
          >
            Solicitar um novo link
          </Link>
        }
      >
        <FormAlert message="Solicite um novo link de recuperacao para continuar." />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar nova senha" subtitle="Escolha uma senha que você ainda não usa.">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert message={formError} /> : null}

        <TextField
          label="Nova senha"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="Use ao menos 8 caracteres, com letras e numeros."
          required
          autoFocus
          error={apiError?.fieldError('password')}
        />

        <TextField
          label="Confirme a nova senha"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
          error={apiError?.fieldError('passwordConfirmation')}
        />

        <Button type="submit" size="lg" loading={mutation.isPending} className="w-full">
          Redefinir senha
        </Button>

        <p className="text-center text-[0.75rem] text-[var(--color-text-subtle)]">
          Por seguranca, todas as sessoes abertas serao encerradas.
        </p>
      </form>
    </AuthShell>
  );
}
