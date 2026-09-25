import type { AppointmentStatus, DashboardOverview } from '@petflow/contracts';

/**
 * DADOS DE DEMONSTRACAO -- existem somente no navegador, para a landing
 * renderizar as telas reais do produto. Nada aqui vai para a API ou para o
 * banco. Toda vitrine que usa estes dados exibe o selo "Demonstracao".
 */

export const DEMO_TIMEZONE = 'America/Sao_Paulo';

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Horario de hoje (local de Sao Paulo, UTC-3) em ISO UTC. */
function todayAt(time: string): string {
  return new Date(`${isoDate(0)}T${time}:00-03:00`).toISOString();
}

function weekBounds(): { start: string; end: string } {
  const weekday = new Date().getDay();
  return { start: isoDate(-weekday), end: isoDate(6 - weekday) };
}

const REVENUE = [
  [620, 540], [710, 690], [480, 480], [0, 0], [820, 760], [760, 700], [900, 845],
  [680, 610], [740, 740], [560, 505], [0, 0], [860, 790], [930, 880], [1180, 740],
];

const week = weekBounds();

export const DEMO_DASHBOARD: DashboardOverview = {
  referenceDate: isoDate(0),
  timezone: DEMO_TIMEZONE,
  today: {
    total: 14,
    scheduled: 2,
    confirmed: 4,
    inProgress: 1,
    completed: 5,
    cancelled: 1,
    noShow: 1,
    expectedRevenue: 1180,
    receivedRevenue: 740,
    lostRevenue: 190,
  },
  week: {
    weekStart: week.start,
    weekEnd: week.end,
    expectedRevenue: 5840,
    receivedRevenue: 4210,
    lostRevenue: 610,
  },
  customers: { total: 312, newThisMonth: 18, inactive: 23, inactiveThresholdDays: 60 },
  pendingReturns: 9,
  upcoming: [
    { id: 'u1', startsAt: todayAt('14:00'), endsAt: todayAt('15:00'), status: 'CONFIRMED', customerName: 'Mariana Costa', customerWhatsapp: null, petName: 'Thor', serviceName: 'Banho e tosa', price: 120 },
    { id: 'u2', startsAt: todayAt('14:30'), endsAt: todayAt('15:00'), status: 'SCHEDULED', customerName: 'Rafael Lima', customerWhatsapp: null, petName: 'Mel', serviceName: 'Banho', price: 70 },
    { id: 'u3', startsAt: todayAt('15:30'), endsAt: todayAt('16:30'), status: 'CONFIRMED', customerName: 'Juliana Alves', customerWhatsapp: null, petName: 'Bento', serviceName: 'Tosa higiênica', price: 90 },
    { id: 'u4', startsAt: todayAt('16:30'), endsAt: todayAt('17:00'), status: 'SCHEDULED', customerName: 'Carlos Souza', customerWhatsapp: null, petName: 'Luna', serviceName: 'Hidratação', price: 60 },
  ],
  revenueSeries: REVENUE.map(([expected, received], index) => ({
    date: isoDate(index - (REVENUE.length - 1)),
    expected: expected!,
    received: received!,
  })),
};

export interface DemoAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  price: number;
  customerName: string;
  customerWhatsapp: string | null;
  petName: string;
  serviceName: string;
  professionalName: string | null;
}

export const DEMO_AGENDA: DemoAppointment[] = [
  { id: 'a1', startsAt: todayAt('08:30'), endsAt: todayAt('09:30'), status: 'COMPLETED', price: 120, customerName: 'Fernanda Rocha', customerWhatsapp: null, petName: 'Bidu', serviceName: 'Banho e tosa', professionalName: 'Paula' },
  { id: 'a2', startsAt: todayAt('10:00'), endsAt: todayAt('10:30'), status: 'IN_PROGRESS', price: 70, customerName: 'André Martins', customerWhatsapp: null, petName: 'Nina', serviceName: 'Banho', professionalName: 'Diego' },
  { id: 'a3', startsAt: todayAt('11:00'), endsAt: todayAt('12:00'), status: 'CONFIRMED', price: 150, customerName: 'Mariana Costa', customerWhatsapp: null, petName: 'Thor', serviceName: 'Tosa completa', professionalName: 'Paula' },
  { id: 'a4', startsAt: todayAt('13:30'), endsAt: todayAt('14:00'), status: 'NO_SHOW', price: 80, customerName: 'Lucas Pereira', customerWhatsapp: null, petName: 'Pipoca', serviceName: 'Banho', professionalName: null },
];

export const DEMO_CUSTOMER = {
  name: 'Mariana Costa',
  phone: '(11) 98765-4321',
  since: 'Cliente há 2 anos',
  stats: [
    { label: 'Atendimentos', value: '38' },
    { label: 'Total gasto', value: 'R$ 4.320' },
    { label: 'Última visita', value: 'há 12 dias' },
  ],
  pets: [
    { name: 'Thor', species: 'DOG' as const, detail: 'Golden Retriever · 4 anos' },
    { name: 'Mia', species: 'CAT' as const, detail: 'Siamês · 2 anos' },
  ],
  history: [
    { service: 'Banho e tosa', pet: 'Thor', when: 'há 12 dias', price: 'R$ 120' },
    { service: 'Hidratação', pet: 'Mia', when: 'há 1 mês', price: 'R$ 60' },
    { service: 'Tosa completa', pet: 'Thor', when: 'há 1 mês', price: 'R$ 150' },
  ],
};
