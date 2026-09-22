import type { CustomerDto, PetSpecies, ServiceDto, Tenant } from '@petflow/contracts';
import { PET_SPECIES_LABELS } from '@petflow/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Check, PawPrint } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { SESSION_QUERY_KEY, useCurrentSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';

const TOTAL_STEPS = 6;

interface WizardState {
  serviceId: string | null;
  customerId: string | null;
  petId: string | null;
}

function StepShell({
  step,
  title,
  description,
  children,
  onSkip,
}: {
  step: number;
  title: string;
  description: string;
  children: ReactNode;
  onSkip: () => void;
}) {
  return (
    <div>
      <p className="text-[0.75rem] font-medium tracking-wide text-[var(--color-text-subtle)] uppercase">
        Passo {step} de {TOTAL_STEPS}
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-[0.875rem] text-[var(--color-text-muted)]">{description}</p>

      <div className="mt-6">{children}</div>

      <button
        type="button"
        onClick={onSkip}
        className="mt-4 text-[0.8125rem] text-[var(--color-text-subtle)] underline-offset-4 hover:text-[var(--color-text-muted)] hover:underline"
      >
        Pular esta etapa
      </button>
    </div>
  );
}

const SPECIES_OPTIONS = Object.entries(PET_SPECIES_LABELS).map(([value, label]) => ({ value, label }));

export function OnboardingPage() {
  const session = useCurrentSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<WizardState>({ serviceId: null, customerId: null, petId: null });

  const progress = Math.round(((step - 1) / TOTAL_STEPS) * 100);

  function goNext(): void {
    if (step >= TOTAL_STEPS) {
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      navigate('/painel', { replace: true });
      return;
    }
    setStep((value) => value + 1);
  }

  async function handleCompany(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      await api.patch<Tenant>('/tenants/current', {
        phone: String(data.get('phone') ?? ''),
        whatsapp: String(data.get('whatsapp') ?? ''),
      });
      toast.success('Dados da empresa salvos.');
      goNext();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleService(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const service = await api.post<ServiceDto>('/services', {
        name: String(data.get('name') ?? ''),
        durationMinutes: Number(data.get('durationMinutes') ?? 60),
        price: Number(data.get('price') ?? 0),
      });
      setState((current) => ({ ...current, serviceId: service.id }));
      toast.success('Servico cadastrado.');
      goNext();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleHours(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      await api.patch<Tenant>('/tenants/current', {
        settings: {
          businessHours: {
            start: String(data.get('start') ?? '08:00'),
            end: String(data.get('end') ?? '18:00'),
            weekdays: [1, 2, 3, 4, 5, 6],
          },
        },
      });
      toast.success('Horario de funcionamento salvo.');
      goNext();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCustomer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const customer = await api.post<CustomerDto>('/customers', {
        name: String(data.get('name') ?? ''),
        phone: String(data.get('phone') ?? ''),
      });
      setState((current) => ({ ...current, customerId: customer.id }));
      toast.success('Cliente cadastrado.');
      goNext();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePet(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.customerId) {
      toast.error('Cadastre um cliente no passo anterior para adicionar um pet.');
      return;
    }
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const pet = await api.post<{ id: string }>('/pets', {
        customerId: state.customerId,
        name: String(data.get('name') ?? ''),
        species: String(data.get('species') ?? 'DOG') as PetSpecies,
      });
      setState((current) => ({ ...current, petId: pet.id }));
      toast.success('Pet cadastrado.');
      goNext();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAppointment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.customerId || !state.petId || !state.serviceId) {
      toast.error('Complete os passos de servico, cliente e pet antes de agendar.');
      return;
    }
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const date = String(data.get('date') ?? '');
      const time = String(data.get('time') ?? '09:00');
      await api.post('/appointments', {
        customerId: state.customerId,
        petId: state.petId,
        serviceId: state.serviceId,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
      });
      toast.success('Primeiro agendamento criado!');
      goNext();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel agendar.');
    } finally {
      setSaving(false);
    }
  }

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="min-h-dvh bg-[var(--color-canvas)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <PawPrint aria-hidden className="size-5 text-[var(--color-brand)]" />
          <span className="font-semibold tracking-tight">{session.tenant.name}</span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="text-[0.8125rem] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Ir direto ao painel
        </button>
      </header>

      <div className="h-1 w-full bg-[var(--color-surface-sunken)]">
        <div
          className="h-full bg-[var(--color-brand)] transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <main className="mx-auto w-full max-w-md px-5 py-10 sm:px-6">
        {step === 1 ? (
          <StepShell step={1} title="Dados do pet shop" description="Telefone e WhatsApp para contato com os clientes." onSkip={goNext}>
            <form onSubmit={handleCompany} className="flex flex-col gap-4">
              <TextField label="Telefone" name="phone" type="tel" placeholder="(11) 3333-4444" />
              <TextField label="WhatsApp" name="whatsapp" type="tel" placeholder="(11) 98888-7777" required />
              <Button type="submit" loading={saving} className="w-full">
                Salvar e continuar
              </Button>
            </form>
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell step={2} title="Cadastre seu primeiro servico" description="O que voce oferece, quanto dura e quanto custa." onSkip={goNext}>
            <form onSubmit={handleService} className="flex flex-col gap-4">
              <TextField label="Nome do servico" name="name" placeholder="Banho e Tosa" required autoFocus />
              <div className="grid grid-cols-2 gap-4">
                <TextField label="Duracao (min)" name="durationMinutes" type="number" min={5} defaultValue={60} required />
                <TextField label="Preco (R$)" name="price" type="number" min={0} step="0.01" defaultValue={50} required />
              </div>
              <Button type="submit" loading={saving} className="w-full">
                Salvar e continuar
              </Button>
            </form>
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell step={3} title="Horario de funcionamento" description="Usado para orientar a agenda." onSkip={goNext}>
            <form onSubmit={handleHours} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <TextField label="Abre" name="start" type="time" defaultValue="08:00" required />
                <TextField label="Fecha" name="end" type="time" defaultValue="18:00" required />
              </div>
              <Button type="submit" loading={saving} className="w-full">
                Salvar e continuar
              </Button>
            </form>
          </StepShell>
        ) : null}

        {step === 4 ? (
          <StepShell step={4} title="Cadastre seu primeiro cliente" description="Nome e WhatsApp bastam para comecar." onSkip={goNext}>
            <form onSubmit={handleCustomer} className="flex flex-col gap-4">
              <TextField label="Nome do cliente" name="name" placeholder="Joana Ferreira" required autoFocus />
              <TextField label="WhatsApp" name="phone" type="tel" placeholder="(11) 98888-7777" required />
              <Button type="submit" loading={saving} className="w-full">
                Salvar e continuar
              </Button>
            </form>
          </StepShell>
        ) : null}

        {step === 5 ? (
          <StepShell step={5} title="Cadastre o pet" description="O bichinho do cliente que voce acabou de cadastrar." onSkip={goNext}>
            {!state.customerId ? (
              <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--color-text-muted)]">
                Voce pulou o passo do cliente -- cadastre um pet a qualquer momento em Pets.
              </p>
            ) : null}
            <form onSubmit={handlePet} className="flex flex-col gap-4">
              <TextField label="Nome do pet" name="name" placeholder="Thor" required autoFocus disabled={!state.customerId} />
              <SelectField label="Especie" name="species" options={SPECIES_OPTIONS} defaultValue="DOG" disabled={!state.customerId} />
              <Button type="submit" loading={saving} className="w-full" disabled={!state.customerId}>
                Salvar e continuar
              </Button>
            </form>
          </StepShell>
        ) : null}

        {step === 6 ? (
          <StepShell step={6} title="Crie o primeiro agendamento" description="Veja como fica um atendimento marcado." onSkip={goNext}>
            {!state.customerId || !state.petId || !state.serviceId ? (
              <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--color-text-muted)]">
                Complete os passos de servico, cliente e pet para agendar por aqui -- ou crie o primeiro
                agendamento depois, na Agenda.
              </p>
            ) : null}
            <form onSubmit={handleAppointment} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <TextField label="Data" name="date" type="date" defaultValue={tomorrow} required disabled={!state.petId} />
                <TextField label="Hora" name="time" type="time" defaultValue="09:00" required disabled={!state.petId} />
              </div>
              <Button type="submit" loading={saving} className="w-full" disabled={!state.petId}>
                <Check aria-hidden className="size-4" />
                Agendar e concluir
              </Button>
            </form>
          </StepShell>
        ) : null}
      </main>
    </div>
  );
}
