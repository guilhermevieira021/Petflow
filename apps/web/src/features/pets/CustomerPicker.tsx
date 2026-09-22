import type { CustomerDto, Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField, TextField } from '@/components/ui/Field';
import { api } from '@/lib/api';

/**
 * Selecao de cliente por busca -- usado quando o formulario de pet ou de
 * agendamento nao chega com o cliente ja definido (ex.: "+ Novo pet" na
 * listagem geral, em vez de dentro do perfil de um cliente).
 *
 * E um <select> nativo populado pela busca, nao um combobox customizado: menos
 * codigo, acessivel por padrao, e resolve o caso de uso sem exigir uma
 * biblioteca so para isto.
 */
export function CustomerPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (customerId: string) => void;
  error?: string;
}) {
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['customers', 'picker', search],
    queryFn: () => api.get<Paginated<CustomerDto>>('/customers', { search: search || undefined, pageSize: 25 }),
  });

  const options = (query.data?.data ?? []).map((customer) => ({
    value: customer.id,
    label: `${customer.name} - ${customer.phone}`,
  }));

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Buscar cliente"
        name="customerSearch"
        placeholder="Digite o nome ou telefone"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <SelectField
        label="Cliente"
        name="customerId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        error={error}
        options={[{ value: '', label: query.isLoading ? 'Carregando...' : 'Selecione um cliente' }, ...options]}
      />
    </div>
  );
}
