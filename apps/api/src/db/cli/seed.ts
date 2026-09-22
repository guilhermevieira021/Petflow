import { DEFAULT_TENANT_SETTINGS, type PetSpecies, type PetSex } from '@petflow/contracts';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../../core/crypto.js';
import { logger } from '../../core/logger.js';
import { toMoneyLiteral } from '../../core/serialization.js';
import { closeDatabase } from '../client.js';
import { withSystem } from '../context.js';
import { runMigrations } from '../migrator.js';
import {
  appointments,
  customers,
  payments,
  pets,
  plans,
  services,
  subscriptions,
  tenants,
  users,
} from '../schema/index.js';
import { env } from '../../config/env.js';

/**
 * Seed de desenvolvimento.
 *
 * Os dados sao ficticios de ponta a ponta -- nomes, telefones e emails foram
 * inventados para este arquivo. Nenhum dado pessoal real entra aqui.
 *
 * Cria DOIS tenants de proposito. Com um so, e facil escrever codigo que
 * "funciona" simplesmente porque nunca existiu um segundo pet shop para
 * vazar dados. O segundo tenant e o canario do isolamento.
 */

const DEMO_PASSWORD = 'petflow123';

const SERVICE_TEMPLATES = [
  { name: 'Banho', description: 'Banho com secagem e perfume', durationMinutes: 60, price: 60, color: '#2F6BFF' },
  { name: 'Banho e Tosa', description: 'Banho completo com tosa higienica', durationMinutes: 90, price: 95, color: '#7C3AED' },
  { name: 'Tosa na Maquina', description: 'Tosa completa na maquina', durationMinutes: 75, price: 80, color: '#0EA5E9' },
  { name: 'Tosa na Tesoura', description: 'Tosa artesanal feita na tesoura', durationMinutes: 120, price: 140, color: '#F59E0B' },
  { name: 'Hidratacao', description: 'Hidratacao profunda dos pelos', durationMinutes: 45, price: 70, color: '#10B981' },
  { name: 'Corte de Unhas', description: 'Corte e lixamento das unhas', durationMinutes: 20, price: 25, color: '#EC4899' },
];

const CUSTOMER_TEMPLATES = [
  { name: 'Joao Batista Silva', phone: '11985550101', email: 'joao.silva@exemplo.com.br' },
  { name: 'Maria Aparecida Souza', phone: '11985550102', email: 'maria.souza@exemplo.com.br' },
  { name: 'Carlos Eduardo Lima', phone: '11985550103', email: null },
  { name: 'Ana Beatriz Ferreira', phone: '11985550104', email: 'ana.ferreira@exemplo.com.br' },
  { name: 'Roberto Carvalho', phone: '11985550105', email: null },
  { name: 'Juliana Ribeiro', phone: '11985550106', email: 'juliana.ribeiro@exemplo.com.br' },
  { name: 'Fernando Alves', phone: '11985550107', email: null },
  { name: 'Patricia Nogueira', phone: '11985550108', email: 'patricia.nogueira@exemplo.com.br' },
  { name: 'Ricardo Mendes', phone: '11985550109', email: null },
  { name: 'Camila Torres', phone: '11985550110', email: 'camila.torres@exemplo.com.br' },
  { name: 'Eduardo Pacheco', phone: '11985550111', email: null },
  { name: 'Larissa Antunes', phone: '11985550112', email: 'larissa.antunes@exemplo.com.br' },
];

interface PetTemplate {
  name: string;
  species: PetSpecies;
  breed: string;
  sex: PetSex;
  weightKg: number;
  color: string;
}

const PET_TEMPLATES: PetTemplate[] = [
  { name: 'Thor', species: 'DOG', breed: 'Golden Retriever', sex: 'MALE', weightKg: 32.5, color: 'Dourado' },
  { name: 'Mel', species: 'DOG', breed: 'Shih Tzu', sex: 'FEMALE', weightKg: 6.2, color: 'Branco e caramelo' },
  { name: 'Bidu', species: 'DOG', breed: 'Poodle', sex: 'MALE', weightKg: 9.8, color: 'Preto' },
  { name: 'Nina', species: 'CAT', breed: 'Siames', sex: 'FEMALE', weightKg: 4.1, color: 'Creme' },
  { name: 'Simba', species: 'CAT', breed: 'Persa', sex: 'MALE', weightKg: 5.4, color: 'Laranja' },
  { name: 'Luna', species: 'DOG', breed: 'Border Collie', sex: 'FEMALE', weightKg: 18.3, color: 'Preto e branco' },
  { name: 'Bob', species: 'DOG', breed: 'Beagle', sex: 'MALE', weightKg: 12.7, color: 'Tricolor' },
  { name: 'Amora', species: 'DOG', breed: 'Lhasa Apso', sex: 'FEMALE', weightKg: 7.5, color: 'Cinza' },
  { name: 'Pipoca', species: 'CAT', breed: 'SRD', sex: 'FEMALE', weightKg: 3.8, color: 'Rajado' },
  { name: 'Zeus', species: 'DOG', breed: 'Pastor Alemao', sex: 'MALE', weightKg: 38.0, color: 'Preto e marrom' },
  { name: 'Fiona', species: 'DOG', breed: 'Yorkshire', sex: 'FEMALE', weightKg: 3.2, color: 'Castanho' },
  { name: 'Mingau', species: 'CAT', breed: 'SRD', sex: 'MALE', weightKg: 4.6, color: 'Branco' },
  { name: 'Bella', species: 'DOG', breed: 'Maltes', sex: 'FEMALE', weightKg: 4.0, color: 'Branco' },
  { name: 'Rex', species: 'DOG', breed: 'Rottweiler', sex: 'MALE', weightKg: 45.2, color: 'Preto' },
  { name: 'Lola', species: 'DOG', breed: 'Bulldog Frances', sex: 'FEMALE', weightKg: 11.4, color: 'Tigrado' },
  { name: 'Tofu', species: 'RODENT', breed: 'Hamster Sirio', sex: 'MALE', weightKg: 0.15, color: 'Bege' },
  { name: 'Kiwi', species: 'BIRD', breed: 'Calopsita', sex: 'FEMALE', weightKg: 0.1, color: 'Amarelo' },
  { name: 'Nick', species: 'DOG', breed: 'Pinscher', sex: 'MALE', weightKg: 4.8, color: 'Preto' },
];

/**
 * Gerador pseudoaleatorio com semente fixa: rodar o seed duas vezes produz
 * exatamente a mesma agenda, o que torna bugs reproduziveis.
 */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('Lista vazia no seed.');
  return item;
}

/** Instante no dia util, entre 08:00 e 17:00, em passos de 30 minutos. */
function slotAt(dayOffset: number, slotIndex: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(8 + Math.floor(slotIndex / 2), (slotIndex % 2) * 30, 0, 0);
  return date;
}

async function seedTenant(
  tx: Parameters<Parameters<typeof withSystem>[0]>[0],
  config: {
    name: string;
    slug: string;
    primaryColor: string;
    emailDomain: string;
    customerCount: number;
    seed: number;
    /** PRO/ACTIVE para explorar o produto sem limites; TRIAL para testar o paywall. */
    plan: 'TRIAL' | 'PRO';
    /** So relevante quando plan='TRIAL'. Permite semear um trial quase no fim. */
    trialHoursRemaining?: number;
  },
): Promise<void> {
  const random = createRandom(config.seed);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const [tenant] = await tx
    .insert(tenants)
    .values({
      name: config.name,
      slug: config.slug,
      primaryColor: config.primaryColor,
      phone: '1133334444',
      whatsapp: '11985550100',
      email: `contato@${config.emailDomain}`,
      timezone: 'America/Sao_Paulo',
      address: {
        street: 'Rua das Acacias',
        number: '250',
        district: 'Centro',
        city: 'Sao Paulo',
        state: 'SP',
        zipCode: '01310000',
      },
      settings: DEFAULT_TENANT_SETTINGS,
    })
    .returning({ id: tenants.id });

  if (!tenant) throw new Error('Falha ao criar tenant no seed.');
  const tenantId = tenant.id;

  const [plan] = await tx.select().from(plans).where(eq(plans.code, config.plan)).limit(1);
  if (!plan) throw new Error(`Plano ${config.plan} nao encontrado. Rode as migrations antes do seed.`);

  await tx.insert(subscriptions).values(
    config.plan === 'PRO'
      ? {
          tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      : {
          tenantId,
          planId: plan.id,
          status: 'TRIALING',
          trialEndsAt: new Date(
            Date.now() + (config.trialHoursRemaining ?? plan.trialHours ?? 48) * 60 * 60 * 1000,
          ),
        },
  );

  const userRows = await tx
    .insert(users)
    .values([
      { tenantId, name: 'Marcos Proprietario', email: `owner@${config.emailDomain}`, passwordHash, role: 'OWNER' },
      { tenantId, name: 'Sandra Gerente', email: `admin@${config.emailDomain}`, passwordHash, role: 'ADMIN' },
      { tenantId, name: 'Bruno Atendente', email: `staff@${config.emailDomain}`, passwordHash, role: 'STAFF' },
    ])
    .returning({ id: users.id, role: users.role });

  const professionals = userRows.filter((user) => user.role !== 'OWNER').map((user) => user.id);

  const serviceRows = await tx
    .insert(services)
    .values(
      SERVICE_TEMPLATES.map((service) => ({
        tenantId,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        price: toMoneyLiteral(service.price),
        color: service.color,
      })),
    )
    .returning({ id: services.id, durationMinutes: services.durationMinutes, price: services.price });

  const customerRows = await tx
    .insert(customers)
    .values(
      CUSTOMER_TEMPLATES.slice(0, config.customerCount).map((customer) => ({
        tenantId,
        name: customer.name,
        phone: customer.phone,
        whatsapp: customer.phone,
        email: customer.email,
        notes: null,
      })),
    )
    .returning({ id: customers.id });

  // Distribui os pets entre os clientes: alguns tem dois, a maioria tem um.
  const petValues = PET_TEMPLATES.slice(0, customerRows.length + 6).map((pet, index) => {
    const owner = customerRows[index % customerRows.length];
    if (!owner) throw new Error('Cliente ausente no seed.');
    return {
      tenantId,
      customerId: owner.id,
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      sex: pet.sex,
      weightKg: pet.weightKg.toFixed(2),
      color: pet.color,
    };
  });

  const petRows = await tx
    .insert(pets)
    .values(petValues)
    .returning({ id: pets.id, customerId: pets.customerId });

  // Agenda de -45 a +10 dias. O passado recebe status finais; o futuro fica
  // entre agendado e confirmado. Assim o dashboard, o historico e a tela de
  // recuperacao de clientes tem dados plausiveis desde o primeiro login.
  const appointmentValues: (typeof appointments.$inferInsert)[] = [];
  const usedSlots = new Set<string>();

  for (let dayOffset = -45; dayOffset <= 10; dayOffset += 1) {
    const weekday = new Date(Date.now() + dayOffset * 86_400_000).getDay();
    if (weekday === 0) continue; // domingo fechado

    const perDay = 2 + Math.floor(random() * 4);
    for (let index = 0; index < perDay; index += 1) {
      const pet = pick(random, petRows);
      const service = pick(random, serviceRows);
      const professional = pick(random, professionals);
      const slotIndex = Math.floor(random() * 18);

      // Nao geramos dois agendamentos no mesmo horario com o mesmo
      // profissional: o seed precisa respeitar a mesma regra da aplicacao.
      const slotKey = `${dayOffset}:${slotIndex}:${professional}`;
      if (usedSlots.has(slotKey)) continue;
      usedSlots.add(slotKey);

      const startsAt = slotAt(dayOffset, slotIndex);
      const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

      let status: (typeof appointments.$inferInsert)['status'] = 'SCHEDULED';
      let cancelledAt: Date | null = null;
      let completedAt: Date | null = null;

      if (dayOffset < 0) {
        const roll = random();
        if (roll < 0.78) {
          status = 'COMPLETED';
          completedAt = endsAt;
        } else if (roll < 0.9) {
          status = 'CANCELLED';
          cancelledAt = new Date(startsAt.getTime() - 3_600_000);
        } else {
          status = 'NO_SHOW';
        }
      } else if (dayOffset === 0) {
        status = pick(random, ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'SCHEDULED'] as const);
        if (status === 'COMPLETED') completedAt = endsAt;
      } else {
        status = random() < 0.55 ? 'CONFIRMED' : 'SCHEDULED';
      }

      appointmentValues.push({
        tenantId,
        customerId: pet.customerId,
        petId: pet.id,
        serviceId: service.id,
        professionalId: professional ?? null,
        startsAt,
        endsAt,
        status,
        price: service.price,
        cancelledAt,
        completedAt,
      });
    }
  }

  const appointmentRows = await tx
    .insert(appointments)
    .values(appointmentValues)
    .returning({
      id: appointments.id,
      customerId: appointments.customerId,
      status: appointments.status,
      price: appointments.price,
      endsAt: appointments.endsAt,
    });

  const paymentValues = appointmentRows
    .filter((appointment) => appointment.status === 'COMPLETED')
    .map((appointment) => ({
      tenantId,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      amount: appointment.price,
      method: pick(random, ['PIX', 'CASH', 'DEBIT_CARD', 'CREDIT_CARD'] as const),
      status: 'PAID' as const,
      paidAt: appointment.endsAt,
    }));

  if (paymentValues.length > 0) {
    await tx.insert(payments).values(paymentValues);
  }

  logger.info(
    {
      tenant: config.name,
      slug: config.slug,
      usuarios: userRows.length,
      servicos: serviceRows.length,
      clientes: customerRows.length,
      pets: petRows.length,
      agendamentos: appointmentRows.length,
      pagamentos: paymentValues.length,
    },
    'Tenant populado',
  );
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('O seed nunca deve ser executado em producao.');
  }

  await runMigrations();

  await withSystem(async (tx) => {
    const [existing] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, 'petflow-demo'))
      .limit(1);

    if (existing) {
      throw new Error(
        'O tenant demo ja existe. Rode "npm run db:reset" para recriar o banco do zero.',
      );
    }

    // Tenant 1: PRO/ACTIVE -- explora o produto inteiro, sem limite de plano.
    await seedTenant(tx, {
      name: 'Pet Shop Amigo Fiel',
      slug: 'petflow-demo',
      primaryColor: '#2F6BFF',
      emailDomain: 'demo.com',
      customerCount: 12,
      seed: 20_260_101,
      plan: 'PRO',
    });

    // Tenant 2: alem de provar isolamento, fica em TRIAL a 5h do fim -- da
    // para ver o banner, o aviso de countdown e o paywall sem esperar 48h.
    await seedTenant(tx, {
      name: 'Mundo Animal Centro',
      slug: 'mundo-animal',
      primaryColor: '#0F766E',
      emailDomain: 'mundoanimal.com',
      customerCount: 6,
      seed: 777_001,
      plan: 'TRIAL',
      trialHoursRemaining: 5,
    });
  });

  logger.info(
    {
      login: `owner@demo.com / admin@demo.com / staff@demo.com`,
      senha: DEMO_PASSWORD,
      plano: 'PRO (ativo, sem limites)',
      segundoTenant: 'owner@mundoanimal.com (mesma senha, TRIAL a 5h do fim)',
    },
    'Seed concluido',
  );
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    logger.error({ err: error instanceof Error ? error.message : error }, 'Seed falhou');
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
