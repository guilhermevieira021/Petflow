import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { AuthShell, FormAlert } from './AuthShell';
import { useLogin } from './session';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginMutation = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const destination = (location.state as { from?: string } | null)?.from ?? '/painel';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    try {
      await loginMutation.mutateAsync({ email, password });
      navigate(destination, { replace: true });
    } catch (error) {
      // A mensagem vem pronta do backend e ja e deliberadamente generica
      // ("Email ou senha incorretos") para nao revelar quais emails existem.
      setFormError(
        error instanceof ApiError ? error.message : 'Nao foi possivel entrar. Tente novamente.',
      );
    }
  }

  const fieldError =
    loginMutation.error instanceof ApiError ? loginMutation.error : null;

  return (
    <AuthShell
      title="Bem-vindo de volta"
      subtitle="Entre para ver a agenda e os resultados do seu pet shop."
      footer={
        <p className="text-[var(--color-text-muted)]">
          Ainda não usa o Petflow?{' '}
          <Link
            to="/criar-conta"
            className="font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
          >
            Comece seu teste grátis
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert message={formError} /> : null}

        <TextField
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@seupetshop.com.br"
          required
          autoFocus
          error={fieldError?.fieldError('email')}
        />

        <div>
          <TextField
            label="Senha"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Sua senha"
            required
            error={fieldError?.fieldError('password')}
          />
          <div className="mt-1.5 text-right">
            <Link
              to="/esqueci-senha"
              className="text-[0.8125rem] text-[var(--color-text-muted)] underline-offset-4 hover:text-[var(--color-text)] hover:underline"
            >
              Esqueci minha senha
            </Link>
          </div>
        </div>

        <Button type="submit" size="lg" loading={loginMutation.isPending} className="mt-1 w-full">
          Entrar
        </Button>
      </form>
    </AuthShell>
  );
}
