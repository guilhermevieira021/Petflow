import { z } from 'zod';

/**
 * Validacao do ambiente no boot.
 *
 * Regra: o processo NAO sobe com configuracao invalida. Falhar aqui, alto e
 * cedo, e infinitamente melhor do que descobrir em producao que AUTH_SECRET
 * estava vazio.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    HOST: z.string().default('0.0.0.0'),
    APP_URL: z.string().url().default('http://localhost:5173'),

    DB_DRIVER: z.enum(['postgres', 'pglite']).default('pglite'),
    DATABASE_URL: z.string().optional(),
    PGLITE_DATA_DIR: z.string().default('./.data/pglite'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET deve ter no minimo 32 caracteres.'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    SESSION_COOKIE_NAME: z.string().min(1).default('petflow_session'),
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((value) => (value == null || value.trim() === '' ? undefined : value)),

    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    MAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().default('nao-responda@petflow.app'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    WHATSAPP_PROVIDER: z.enum(['link', 'cloud_api']).default('link'),
    WHATSAPP_API_URL: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

    // Checkout hospedado do plano PRO na Cakto. Link estatico, fornecido
    // pelo dono do produto -- ver CAKTO.md. Sem isso configurado, o botao
    // "Assinar PRO" informa honestamente que o checkout nao esta disponivel.
    CAKTO_PRO_CHECKOUT_URL: z.string().url().optional(),
    // AGUARDANDO CONFIGURACAO DO PROJETO (ver CAKTO.md): a Cakto autentica
    // webhooks de algum jeito (header de assinatura, token na URL, etc.) que
    // ainda nao foi confirmado. Enquanto este valor nao existir, o endpoint
    // de webhook responde 503 -- nunca aceita um POST sem validar a origem.
    CAKTO_WEBHOOK_SECRET: z.string().optional(),

    LOG_LEVEL: z
      .enum(['silent', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.DB_DRIVER === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL e obrigatorio quando DB_DRIVER=postgres.',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.DB_DRIVER !== 'postgres') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DB_DRIVER'],
          message: 'Em producao DB_DRIVER deve ser "postgres". PGlite e apenas para dev/teste.',
        });
      }
      if (env.AUTH_SECRET.startsWith('troque-este-valor')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_SECRET'],
          message: 'AUTH_SECRET ainda esta com o valor de exemplo. Gere um segredo real.',
        });
      }
    }
    if (env.MAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST e obrigatorio quando MAIL_PROVIDER=smtp.',
      });
    }
    if (
      env.WHATSAPP_PROVIDER === 'cloud_api' &&
      (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_ACCESS_TOKEN'],
        message:
          'WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID sao obrigatorios quando WHATSAPP_PROVIDER=cloud_api.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    // Nao usamos o logger aqui: ele depende de env.
    console.error(`\nConfiguracao de ambiente invalida:\n${details}\n`);
    console.error('Copie .env.example para .env e preencha os valores.\n');
    throw new Error('Configuracao de ambiente invalida.');
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';
