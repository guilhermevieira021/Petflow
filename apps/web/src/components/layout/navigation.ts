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
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
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
      { label: 'Dashboard', to: '/painel', icon: LayoutDashboard, permission: Permission.DASHBOARD_READ },
      { label: 'Agenda', to: '/agenda', icon: CalendarDays, permission: Permission.APPOINTMENTS_READ },
      { label: 'Clientes', to: '/clientes', icon: Users, permission: Permission.CUSTOMERS_READ },
      { label: 'Pets', to: '/pets', icon: Dog, permission: Permission.PETS_READ },
      { label: 'Servicos', to: '/servicos', icon: Scissors, permission: Permission.SERVICES_READ },
      {
        label: 'Recuperacao',
        to: '/recuperacao',
        icon: UserRoundCheck,
        permission: Permission.RETENTION_READ,
      },
      { label: 'Mensagens', to: '/mensagens', icon: MessageSquare, permission: Permission.MESSAGES_READ },
      { label: 'Relatorios', to: '/relatorios', icon: BarChart3, permission: Permission.REPORTS_READ },
    ],
  },
  {
    title: 'Gestao',
    items: [
      { label: 'Equipe', to: '/equipe', icon: Users, permission: Permission.USERS_READ },
      { label: 'Configuracoes', to: '/configuracoes', icon: Settings, permission: Permission.SETTINGS_READ },
    ],
  },
  {
    title: 'Conta',
    items: [
      { label: 'Plano e cobranca', to: '/billing', icon: CreditCard, permission: Permission.BILLING_READ },
    ],
  },
];
