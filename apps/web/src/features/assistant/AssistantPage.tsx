import type {
  AssistantAskResultDto,
  AssistantStatusDto,
  AssistantToolDto,
  AssistantToolName,
  AssistantToolResultDto,
} from '@petflow/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Info, Send, Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';

/**
 * Assistente: perguntas prontas respondidas por consultas sobre os dados
 * reais do pet shop. A pergunta livre so aparece habilitada quando o servidor
 * tem um provedor de IA configurado -- e mesmo assim os numeros vem do banco.
 */

function ResultCard({ result }: { result: AssistantToolResultDto }) {
  return (
    <Card className="overflow-hidden" aria-live="polite">
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <p className="text-[0.8125rem] font-medium text-[var(--color-text-muted)]">{result.question}</p>
        <p className="mt-1 text-base font-semibold text-balance">{result.answer}</p>
      </div>
      {result.rows.length > 0 ? (
        <ul className="divide-y divide-[var(--color-border)]">
          {result.rows.map((row, index) => (
            <li key={`${row.label}-${index}`}>
              {row.href ? (
                <Link to={row.href} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-hover)]">
                  <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                  <span className="tabular shrink-0 text-sm font-medium">{row.value}</span>
                  <ArrowRight aria-hidden className="size-3.5 shrink-0 text-[var(--color-text-subtle)]" />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                  <span className="tabular shrink-0 text-sm font-medium">{row.value}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex items-start gap-1.5 bg-[var(--color-surface-sunken)] px-5 py-2.5 text-[0.75rem] text-[var(--color-text-muted)]">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {result.basis} Calculado agora às {formatTime(result.generatedAt)}, direto dos seus dados.
        </span>
      </p>
    </Card>
  );
}

export function AssistantPage() {
  const [active, setActive] = useState<AssistantToolName | null>(null);
  const [freeAnswer, setFreeAnswer] = useState<AssistantAskResultDto | null>(null);

  const toolsQuery = useQuery({
    queryKey: ['assistant', 'tools'],
    queryFn: () => api.get<AssistantToolDto[]>('/assistant/tools'),
  });
  const statusQuery = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => api.get<AssistantStatusDto>('/assistant/status'),
  });

  const runTool = useMutation({
    mutationFn: (name: AssistantToolName) => api.post<AssistantToolResultDto>(`/assistant/tools/${name}`),
  });

  const ask = useMutation({
    mutationFn: (question: string) => api.post<AssistantAskResultDto>('/assistant/ask', { question }),
    onSuccess: setFreeAnswer,
  });

  function choose(name: AssistantToolName): void {
    setActive(name);
    setFreeAnswer(null);
    ask.reset();
    runTool.mutate(name);
  }

  function handleAsk(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const question = String(new FormData(event.currentTarget).get('question') ?? '').trim();
    if (!question) return;
    setActive(null);
    runTool.reset();
    ask.mutate(question);
  }

  const llmReady = statusQuery.data?.languageModelConfigured ?? false;
  const shownResult = freeAnswer?.result ?? (active ? runTool.data : undefined);
  const error = runTool.error ?? ask.error;
  const answerRef = useRef<HTMLDivElement>(null);

  // Layout empilhado (mobile): a resposta fica abaixo da lista -- leva o
  // usuario ate ela em vez de deixar a resposta fora da tela.
  useEffect(() => {
    if (!shownResult && !freeAnswer) return;
    if (window.matchMedia('(min-width: 64rem)').matches) return;
    answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [shownResult, freeAnswer]);

  return (
    <>
      <PageHeader
        eyebrow="Assistente"
        title="Pergunte sobre o seu pet shop"
        description="Respostas calculadas na hora a partir dos seus dados reais: nada é estimado ou inventado."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <CardHeader title="Perguntas prontas" icon={<Sparkles className="size-4" />} />
          {toolsQuery.isLoading ? (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : toolsQuery.isError ? (
            <ErrorState message="Não foi possível carregar as perguntas." onRetry={() => void toolsQuery.refetch()} />
          ) : (
            <ul className="flex flex-col gap-1 p-2">
              {toolsQuery.data?.map((tool) => (
                <li key={tool.name}>
                  <button
                    type="button"
                    aria-pressed={active === tool.name}
                    onClick={() => choose(tool.name)}
                    className={cn(
                      'w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors',
                      active === tool.name
                        ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]'
                        : 'hover:bg-[var(--color-surface-hover)]',
                    )}
                  >
                    <span className="block text-sm font-medium">{tool.question}</span>
                    <span className="mt-0.5 block text-[0.75rem] text-[var(--color-text-muted)]">{tool.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <form onSubmit={handleAsk} className="flex gap-2">
              <label htmlFor="assistant-question" className="sr-only">
                Pergunta livre
              </label>
              <input
                id="assistant-question"
                name="question"
                maxLength={500}
                disabled={!llmReady}
                placeholder={llmReady ? 'Ex.: quanto entrou de dinheiro esta semana?' : 'Pergunta livre indisponível'}
                className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)] disabled:bg-[var(--color-surface-sunken)] disabled:text-[var(--color-text-subtle)]"
              />
              <Button type="submit" disabled={!llmReady} loading={ask.isPending} icon={<Send className="size-4" />}>
                Perguntar
              </Button>
            </form>
            {statusQuery.data && !llmReady ? (
              <p className="mt-2.5 text-[0.8125rem] text-[var(--color-text-muted)]">{statusQuery.data.message}</p>
            ) : null}
          </Card>

          <div ref={answerRef} className="scroll-mt-20" />
          {runTool.isPending || ask.isPending ? (
            <Card className="flex flex-col gap-3 p-5" aria-busy="true">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </Card>
          ) : error ? (
            <Card>
              <ErrorState message={error instanceof ApiError ? error.message : 'Tente novamente.'} />
            </Card>
          ) : freeAnswer && !freeAnswer.matched ? (
            <Card className="p-5 text-sm text-[var(--color-text-muted)]">{freeAnswer.message}</Card>
          ) : shownResult ? (
            <ResultCard result={shownResult} />
          ) : (
            <Card className="p-8 text-center text-sm text-[var(--color-text-muted)]">
              Escolha uma pergunta ao lado para ver a resposta com os números do seu pet shop.
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
