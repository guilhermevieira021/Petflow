import { env, isDevelopment } from '../config/env.js';

/**
 * Configuracao do logger.
 *
 * Fastify ja embarca o pino; aqui apenas montamos as opcoes e expomos uma
 * instancia para uso fora do ciclo de request (migrations, seed, bootstrap).
 *
 * `redact` e a linha de defesa contra vazamento em log: mesmo que alguem
 * logue o objeto inteiro da requisicao por engano, cookie, authorization e
 * campos de senha saem como [REDACTED].
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'password_hash',
  'passwordConfirmation',
  'currentPassword',
  'token',
  'tokenHash',
  'csrfSecret',
  '*.password',
  '*.passwordHash',
  '*.token',
];

export const loggerOptions = {
  level: env.LOG_LEVEL === 'silent' ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
} as const;

type LogFn = (context: Record<string, unknown> | string, message?: string) => void;

interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

function write(level: 'info' | 'warn' | 'error' | 'debug'): LogFn {
  return (context, message) => {
    if (env.LOG_LEVEL === 'silent') return;
    const payload = typeof context === 'string' ? { message: context } : { ...context, message };
    const line = JSON.stringify({ level, time: new Date().toISOString(), ...payload });
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
}

/**
 * Logger minimo para scripts (migrate/seed) e para o bootstrap, antes de o
 * Fastify existir. Dentro de uma rota, use `request.log`, que ja carrega o
 * requestId.
 */
export const logger: Logger = {
  info: write('info'),
  warn: write('warn'),
  error: write('error'),
  debug: write('debug'),
};
