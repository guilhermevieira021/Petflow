import { PET_HEALTH_TYPE_LABELS, Permission, type DueHealthItemDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Syringe } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { MessageComposerDrawer } from '@/features/messages/MessageComposerDrawer';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format';

/**
 * Retornos de saude: vacinas/vermifugos vencidos ou vencendo em 30 dias
 * (registro mais recente de cada item). Some da tela quando nao ha nada.
 */
export function HealthDueCard() {
  const { can } = useSession();
  const [composer, setComposer] = useState<DueHealthItemDto | null>(null);
  const query = useQuery({
    queryKey: ['health', 'due'],
    queryFn: () => api.get<DueHealthItemDto[]>('/health/due'),
    enabled: can(Permission.PETS_READ),
  });

  const items = query.data ?? [];
  if (items.length === 0) return null;

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Saúde: vacinas e vermífugos"
        description="Vencidos ou vencendo nos próximos 30 dias."
        icon={<Syringe className="size-4" />}
      />
      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <li key={item.recordId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                <Link to={`/pets/${item.petId}`} className="hover:underline">
                  {item.petName}
                </Link>
                <span className="font-normal text-[var(--color-text-muted)]"> · {item.customerName}</span>
              </p>
              <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                {PET_HEALTH_TYPE_LABELS[item.type]}: {item.title}
              </p>
            </div>
            <Badge dot tone={item.dueStatus === 'OVERDUE' ? 'danger' : 'warning'}>
              {item.dueStatus === 'OVERDUE'
                ? `Venceu em ${formatCalendarDate(item.nextDueOn)}`
                : item.daysUntilDue === 0
                  ? 'Vence hoje'
                  : `Vence em ${item.daysUntilDue} ${item.daysUntilDue === 1 ? 'dia' : 'dias'}`}
            </Badge>
            {can(Permission.MESSAGES_SEND) ? (
              <button
                type="button"
                onClick={() => setComposer(item)}
                className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-success-solid)] px-3 py-2 text-[0.8125rem] font-medium text-white hover:opacity-90"
              >
                <MessageCircle aria-hidden className="size-3.5" />
                Avisar tutor
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {composer ? (
        <MessageComposerDrawer
          open
          customerId={composer.customerId}
          customerName={composer.customerName}
          customerWhatsapp={composer.customerWhatsapp}
          petId={composer.petId}
          type="RETURN_INVITE"
          suggestedText={`Olá, ${composer.customerName.split(' ')[0]}! ${
            composer.dueStatus === 'OVERDUE' ? 'A' : 'Está chegando a data da'
          } ${composer.title} do ${composer.petName}${
            composer.dueStatus === 'OVERDUE' ? ` venceu em ${formatCalendarDate(composer.nextDueOn)}` : ` (${formatCalendarDate(composer.nextDueOn)})`
          }. Quer agendar?`}
          onClose={() => setComposer(null)}
        />
      ) : null}
    </Card>
  );
}
