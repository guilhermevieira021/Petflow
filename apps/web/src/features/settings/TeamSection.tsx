import {
  Permission,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Paginated,
  type Role,
  type UserDto,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField, TextField } from '@/components/ui/Field';
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatRelative } from '@/lib/format';

const TEAM_QUERY_KEY = ['users', 'list'] as const;

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'STAFF', label: `${ROLE_LABELS.STAFF} - ${ROLE_DESCRIPTIONS.STAFF}` },
  { value: 'ADMIN', label: `${ROLE_LABELS.ADMIN} - ${ROLE_DESCRIPTIONS.ADMIN}` },
  { value: 'OWNER', label: `${ROLE_LABELS.OWNER} - ${ROLE_DESCRIPTIONS.OWNER}` },
];

const ROLE_TONES = { OWNER: 'brand', ADMIN: 'info', STAFF: 'neutral' } as const;

function InviteForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: { name: string; email: string; password: string; role: Role }) =>
      api.post<UserDto>('/users', input),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
      toast.success(`${user.name} agora faz parte da equipe.`);
      onDone();
    },
    onError: (error) => {
      // Erros por campo aparecem no proprio input; so os globais viram toast.
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(
          error instanceof ApiError ? error.message : 'Nao foi possivel adicionar o usuario.',
        );
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      role: String(data.get('role') ?? 'STAFF') as Role,
    });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome"
          name="name"
          placeholder="Nome completo"
          required
          autoFocus
          error={apiError?.fieldError('name')}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          placeholder="pessoa@seupetshop.com.br"
          required
          error={apiError?.fieldError('email')}
        />
        <TextField
          label="Senha provisoria"
          name="password"
          type="password"
          hint="A pessoa pode troca-la depois em sua conta."
          required
          error={apiError?.fieldError('password')}
        />
        <SelectField
          label="Papel"
          name="role"
          options={ROLE_OPTIONS}
          defaultValue="STAFF"
          error={apiError?.fieldError('role')}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Adicionar a equipe
        </Button>
      </div>
    </form>
  );
}

export function TeamSection() {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [inviting, setInviting] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<UserDto | null>(null);

  const canManage = can(Permission.USERS_WRITE);

  const query = useQuery({
    queryKey: TEAM_QUERY_KEY,
    queryFn: () => api.get<Paginated<UserDto>>('/users', { pageSize: 100 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: Role; active?: boolean } }) =>
      api.patch<UserDto>(`/users/${id}`, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
      toast.success('Equipe atualizada.');
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Nao foi possivel atualizar o usuario.',
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/users/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
      toast.success('Usuario removido da equipe.');
      setPendingRemoval(null);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel remover.');
      setPendingRemoval(null);
    },
  });

  return (
    <Card>
      <CardHeader
        title="Membros"
        description="Papeis conforme cadastrados no sistema."
        action={
          canManage && !inviting ? (
            <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
              Adicionar pessoa
            </Button>
          ) : null
        }
      />

      {inviting ? (
        <CardBody className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
          <InviteForm onDone={() => setInviting(false)} />
        </CardBody>
      ) : null}

      {query.isLoading ? (
        <CardBody className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Carregando equipe</span>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </CardBody>
      ) : null}

      {query.isError ? (
        <ErrorState
          message={
            query.error instanceof ApiError ? query.error.message : 'Tente novamente em instantes.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data && query.data.data.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="Nenhum usuario cadastrado"
          description="Adicione as pessoas que atendem no balcao para que cada uma tenha o seu acesso."
        />
      ) : null}

      {query.data && query.data.data.length > 0 ? (
        <ul className="divide-y divide-[var(--color-border)]">
          {query.data.data.map((user) => {
            const isSelf = user.id === session.user.id;

            return (
              <li key={user.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Avatar name={user.name} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {user.name}
                    {isSelf ? (
                      <span className="text-[0.75rem] font-normal text-[var(--color-text-subtle)]">
                        (voce)
                      </span>
                    ) : null}
                    {!user.active ? <Badge tone="warning">Inativo</Badge> : null}
                  </p>
                  <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                    {user.email}
                  </p>
                </div>

                <p className="hidden text-[0.75rem] text-[var(--color-text-subtle)] sm:block">
                  {user.lastLoginAt ? `Acessou ${formatRelative(user.lastLoginAt)}` : 'Nunca acessou'}
                </p>

                {canManage && !isSelf ? (
                  <select
                    aria-label={`Papel de ${user.name}`}
                    value={user.role}
                    disabled={updateMutation.isPending}
                    onChange={(event) =>
                      updateMutation.mutate({
                        id: user.id,
                        patch: { role: event.target.value as Role },
                      })
                    }
                    className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-[0.8125rem]"
                  >
                    {(['STAFF', 'ADMIN', 'OWNER'] as const).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                )}

                {canManage && !isSelf ? (
                  <button
                    type="button"
                    onClick={() => setPendingRemoval(user)}
                    aria-label={`Remover ${user.name} da equipe`}
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-danger-subtle)] hover:text-[var(--color-danger)]"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remover da equipe?"
        description={
          pendingRemoval
            ? `${pendingRemoval.name} perde o acesso imediatamente e todas as sessoes abertas sao encerradas. O historico de atendimentos e mantido.`
            : ''
        }
        confirmLabel="Remover acesso"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => pendingRemoval && removeMutation.mutate(pendingRemoval.id)}
        onCancel={() => setPendingRemoval(null)}
      />
    </Card>
  );
}
