import { z } from 'zod';

/**
 * Matriz de permissoes -- FONTE UNICA DE VERDADE.
 *
 * O frontend usa esta matriz apenas para decidir o que MOSTRAR.
 * A decisao que realmente vale e a do backend, que consulta exatamente
 * esta mesma matriz no preHandler de cada rota. Esconder um botao nao e
 * autorizacao; e cortesia de UI.
 */

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const roleSchema = z.nativeEnum(Role, {
  errorMap: () => ({ message: 'Papel invalido. Use OWNER, ADMIN ou STAFF.' }),
});

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Proprietario',
  ADMIN: 'Administrador',
  STAFF: 'Atendente',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Acesso total, incluindo configuracoes, equipe e faturamento.',
  ADMIN: 'Gestao operacional completa: clientes, pets, agenda, servicos e indicadores.',
  STAFF: 'Atendimento do dia a dia: clientes, pets, agenda e recebimentos.',
};

/** Hierarquia: usado para impedir que um papel gerencie outro de nivel maior. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  STAFF: 1,
};

export const Permission = {
  DASHBOARD_READ: 'dashboard:read',

  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_WRITE: 'customers:write',
  CUSTOMERS_DELETE: 'customers:delete',

  PETS_READ: 'pets:read',
  PETS_WRITE: 'pets:write',
  PETS_DELETE: 'pets:delete',

  SERVICES_READ: 'services:read',
  SERVICES_WRITE: 'services:write',

  APPOINTMENTS_READ: 'appointments:read',
  APPOINTMENTS_WRITE: 'appointments:write',
  APPOINTMENTS_CANCEL: 'appointments:cancel',

  PAYMENTS_READ: 'payments:read',
  PAYMENTS_WRITE: 'payments:write',

  MESSAGES_READ: 'messages:read',
  MESSAGES_SEND: 'messages:send',

  CAMPAIGNS_READ: 'campaigns:read',
  CAMPAIGNS_WRITE: 'campaigns:write',

  RETENTION_READ: 'retention:read',

  REPORTS_READ: 'reports:read',

  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',

  AUDIT_READ: 'audit:read',

  BILLING_READ: 'billing:read',
  BILLING_WRITE: 'billing:write',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const STAFF_PERMISSIONS: readonly Permission[] = [
  Permission.DASHBOARD_READ,
  Permission.CUSTOMERS_READ,
  Permission.CUSTOMERS_WRITE,
  Permission.PETS_READ,
  Permission.PETS_WRITE,
  Permission.SERVICES_READ,
  Permission.APPOINTMENTS_READ,
  Permission.APPOINTMENTS_WRITE,
  Permission.APPOINTMENTS_CANCEL,
  Permission.PAYMENTS_READ,
  Permission.PAYMENTS_WRITE,
  Permission.MESSAGES_READ,
  Permission.MESSAGES_SEND,
  Permission.RETENTION_READ,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...STAFF_PERMISSIONS,
  Permission.CUSTOMERS_DELETE,
  Permission.PETS_DELETE,
  Permission.SERVICES_WRITE,
  Permission.CAMPAIGNS_READ,
  Permission.CAMPAIGNS_WRITE,
  Permission.REPORTS_READ,
  Permission.SETTINGS_READ,
  Permission.USERS_READ,
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  Permission.SETTINGS_WRITE,
  Permission.USERS_WRITE,
  Permission.AUDIT_READ,
  Permission.BILLING_READ,
  Permission.BILLING_WRITE,
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  STAFF: STAFF_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  OWNER: OWNER_PERMISSIONS,
};

const PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = {
  STAFF: new Set(STAFF_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  OWNER: new Set(OWNER_PERMISSIONS),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_SETS[role].has(permission);
}

export function hasAllPermissions(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

export function hasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * Um usuario so pode criar/editar/remover usuarios de papel igual ou inferior
 * ao seu. Impede escalonamento de privilegio por parte de um ADMIN.
 */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] >= ROLE_RANK[targetRole];
}
