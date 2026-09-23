import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RegisterInput, SessionPayload } from '@petflow/contracts';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api';
import { AuthShell, FormAlert } from './AuthShell';
import { SESSION_QUERY_KEY } from './session';

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const registerMutation = useMutation({
    mutationFn: (input: RegisterInput) => api.post<{ user: unknown }>('/auth/register', input),
    // fetchQuery, NAO invalidateQueries -- mesmo motivo do login (ver
    // session.tsx/useLogin): precisa REJEITAR se /auth/me falhar logo apos o
    // cadastro, senao o app navegaria para o onboarding sem sessao
    // confirmada.
    onSuccess: () =>
      queryClient.fetchQuery({
        queryKey: SESSION_QUERY_KEY,
        queryFn: () => api.get<SessionPayload>('/auth/me'),
      }),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    try {
      await registerMutation.mutateAsync({
        tenantName: String(data.get('tenantName') ?? ''),
        userName: String(data.get('userName') ?? ''),
        email: String(data.get('email') ?? ''),
        password: String(data.get('password') ?? ''),
      });
      // Direto para o onboarding -- e o primeiro contato do dono do pet shop
      // com o produto, e o objetivo e leva-lo ao primeiro valor rapido.
      navigate('/onboarding', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        // Erros por campo ja aparecem abaixo de cada input.
        setFormError(null);
      } else {
        setFormError(
          error instanceof ApiError
            ? error.message
            : 'Nao foi possivel criar a conta. Tente novamente.',
        );
      }
    }
  }

  const apiError = registerMutation.error instanceof ApiError ? registerMutation.error : null;

  return (
    <AuthShell
      title="Cadastre seu pet shop"
      subtitle="Leva menos de um minuto. Voce ja entra direto no sistema."
      footer={
        <p className="text-[var(--color-text-muted)]">
          Ja tem conta?{' '}
          <Link
            to="/entrar"
            className="font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
          >
            Entrar
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert message={formError} /> : null}

        <TextField
          label="Nome do pet shop"
          name="tenantName"
          placeholder="Pet Shop Amigo Fiel"
          required
          autoFocus
          error={apiError?.fieldError('tenantName')}
        />

        <TextField
          label="Seu nome"
          name="userName"
          autoComplete="name"
          placeholder="Como devemos te chamar"
          required
          error={apiError?.fieldError('userName')}
        />

        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@seupetshop.com.br"
          required
          error={apiError?.fieldError('email')}
        />

        <TextField
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Minimo 8 caracteres"
          hint="Use ao menos 8 caracteres, com letras e numeros."
          required
          error={apiError?.fieldError('password')}
        />

        <Button type="submit" size="lg" loading={registerMutation.isPending} className="mt-1 w-full">
          Criar conta e comecar
        </Button>

        <p className="text-center text-[0.75rem] leading-relaxed text-[var(--color-text-subtle)]">
          Voce sera o proprietario da conta, com acesso total as configuracoes e a equipe.
        </p>
      </form>
    </AuthShell>
  );
}
