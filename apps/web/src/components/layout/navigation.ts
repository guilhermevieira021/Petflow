import { Permission } from '@petflow/contracts';
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  Dog,
  LayoutDashboard,
  MessageSquare,
  Scissors,
  Settings,
  UserRoundCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  /** Rotulo curto para a barra inferior do mobile. */
  shortLabel?: string;
  to: string;
  icon: LucideIcon;
  /** Permissao minima para o item aparecer. */
  permission: Permission;
}

export interface NavGroup {
  /** null = grupo principal, sem titulo nem separador acima. */
  title: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { label: 'Início', shortLabel: 'Início', to: '/painel', icon: LayoutDashboard, permission: Permission.DASHBOARD_READ },
      { label: 'Agenda', to: '/agenda', icon: CalendarDays, permission: Permission.APPOINTMENTS_READ },
      { label: 'Clientes', to: '/clientes', icon: Users, permission: Permission.CUSTOMERS_READ },
      { label: 'Pets', to: '/pets', icon: Dog, permission: Permission.PETS_READ },
      { label: 'Serviços', to: '/servicos', icon: Scissors, permission: Permission.SERVICES_READ },
    ],
  },
  {
    title: 'Relacionamento',
    items: [
      {
        label: 'Recuperação',
        to: '/recuperacao',
        icon: UserRoundCheck,
        permission: Permission.RETENTION_READ,
      },
      { label: 'Mensagens', to: '/mensagens', icon: MessageSquare, permission: Permission.MESSAGES_READ },
      { label: 'Relatórios', to: '/relatorios', icon: BarChart3, permission: Permission.REPORTS_READ },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { label: 'Equipe', to: '/equipe', icon: UsersRound, permission: Permission.USERS_READ },
      { label: 'Configurações', to: '/configuracoes', icon: Settings, permission: Permission.SETTINGS_READ },
      { label: 'Plano e cobrança', to: '/billing', icon: CreditCard, permission: Permission.BILLING_READ },
    ],
  },
];

/**
 * Destinos fixos da barra inferior no mobile -- o que o balcao usa o dia
 * inteiro. Todo o resto fica em "Mais". Somente telas que ja existem.
 */
export const MOBILE_PRIMARY_ROUTES = ['/painel', '/agenda', '/clientes', '/pets'];
