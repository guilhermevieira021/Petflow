import type { CustomerDto, Paginated, PetWithCustomerDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { SelectField } from '@/components/ui/Field';
import { SearchInput } from '@/components/ui/SearchInput';
import { api } from '@/lib/api';
import { formatPhone } from '@/lib/format';

/**
 * Cliente e pet OPCIONAIS da venda. Venda de balcao pode ficar sem cliente;
 * com cliente, o pet vem so da lista de pets DELE (a API confere de novo).
 */
export function CustomerPetSelect({
  customer,
  petId,
  onCustomerChange,
  onPetChange,
}: {
  customer: CustomerDto | null;
  petId: string;
  onCustomerChange: (customer: CustomerDto | null) => void;
  onPetChange: (petId: string) => void;
}) {
  const [search, setSearch] = useState('');

  const customersQuery = useQuery({
    queryKey: ['customers', 'sale-picker', search],
    queryFn: () => api.get<Paginated<CustomerDto>>('/customers', { search, pageSize: 6, active: 'true' }),
    enabled: !customer && search.trim().length >= 2,
  });

  const petsQuery = useQuery({
    queryKey: ['pets', 'byCustomer', customer?.id],
    queryFn: () => api.get<Paginated<PetWithCustomerDto>>('/pets', { customerId: customer!.id, pageSize: 50 }),
    enabled: Boolean(customer),
  });

  if (customer) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{customer.name}</p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)]">{formatPhone(customer.whatsapp ?? customer.phone)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              onCustomerChange(null);
              onPetChange('');
            }}
            aria-label="Remover cliente da venda"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-white/70"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <SelectField
          label="Pet (opcional)"
          name="petId"
          value={petId}
          onChange={(event) => onPetChange(event.target.value)}
          options={[
            { value: '', label: petsQuery.isLoading ? 'Carregando...' : 'Sem pet vinculado' },
            ...(petsQuery.data?.data ?? []).map((pet) => ({ value: pet.id, label: pet.name })),
          ]}
        />
      </div>
    );
  }

  const results = customersQuery.data?.data ?? [];

  return (
    <div>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar cliente (opcional)"
        label="Buscar cliente para a venda"
      />
      {search.trim().length >= 2 ? (
        <ul className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]" aria-label="Clientes encontrados">
          {customersQuery.isLoading ? (
            <li className="px-3.5 py-2.5 text-sm text-[var(--color-text-muted)]">Buscando...</li>
          ) : results.length === 0 ? (
            <li className="px-3.5 py-2.5 text-sm text-[var(--color-text-muted)]">Nenhum cliente encontrado.</li>
          ) : (
            results.map((result) => (
              <li key={result.id} className="border-t border-[var(--color-border)] first:border-t-0">
                <button
                  type="button"
                  onClick={() => {
                    onCustomerChange(result);
                    setSearch('');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--color-surface-hover)]"
                >
                  <span className="truncate text-sm font-medium">{result.name}</span>
                  <span className="shrink-0 text-[0.75rem] text-[var(--color-text-muted)]">{formatPhone(result.phone)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="mt-2 text-[0.75rem] text-[var(--color-text-subtle)]">Sem cliente, a venda fica registrada como balcão.</p>
      )}
    </div>
  );
}
