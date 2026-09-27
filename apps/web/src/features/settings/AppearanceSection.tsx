import { THEME_IDS, type BrandColorMode, type Tenant, type ThemeId } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Eye, Palette } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { useTheme } from '@/features/theme/ThemeProvider';
import { ThemeThumbnail } from '@/features/theme/ThemeThumbnail';
import { useSaveAppearance } from '@/features/theme/useSaveAppearance';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { contrastRatio, WCAG_AA_TEXT } from '@/lib/theme/contrast';
import { THEMES } from '@/lib/theme/themes';

export function AppearanceSection({ tenant, readOnly }: { tenant: Tenant; readOnly: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const { appearance, activeThemeId, previewThemeId, setPreviewTheme } = useTheme();
  const saveTheme = useSaveAppearance();
  const savedTheme = appearance?.theme ?? 'original';
  const [brandMode, setBrandMode] = useState<BrandColorMode>(appearance?.brandColorMode ?? 'custom');
  const [color, setColor] = useState(tenant.primaryColor);

  // A previa e so desta tela: sair dela volta ao tema salvo.
  useEffect(() => () => setPreviewTheme(null), [setPreviewTheme]);
  useEffect(() => setBrandMode(appearance?.brandColorMode ?? 'custom'), [appearance?.brandColorMode]);

  function applyTheme(themeId: ThemeId): void {
    setPreviewTheme(null);
    // Escolher um tema passa a usar a cor DO TEMA; a cor propria continua
    // salva e pode ser religada abaixo.
    saveTheme.mutate(
      { theme: themeId, brandColorMode: 'theme' },
      { onSuccess: () => toast.success(`Tema ${THEMES[themeId].name} aplicado.`) },
    );
  }

  const brand = useMutation({
    mutationFn: (payload: { primaryColor: string; logoUrl: string | null; brandColorMode: BrandColorMode }) =>
      api.patch<Tenant>('/tenants/current', {
        primaryColor: payload.primaryColor,
        logoUrl: payload.logoUrl,
        settings: { appearance: { theme: savedTheme, brandColorMode: payload.brandColorMode } },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tenant'] });
      await refresh();
      toast.success('Marca atualizada.');
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      }
    },
  });

  function handleBrandSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const logoUrl = String(new FormData(event.currentTarget).get('logoUrl') ?? '').trim();
    brand.mutate({ primaryColor: color, logoUrl: logoUrl === '' ? null : logoUrl, brandColorMode: brandMode });
  }

  const brandError = brand.error instanceof ApiError ? brand.error : null;
  const colorContrast = /^#[0-9a-fA-F]{6}$/.test(color) ? contrastRatio('#ffffff', color) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Tema"
          description="Escolha como o Petflow aparece para você. Vale para toda a equipe do pet shop."
          icon={<Palette className="size-4" />}
        />
        <CardBody>
          {previewThemeId ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] px-4 py-3"
            >
              <Eye aria-hidden className="size-4 text-[var(--color-brand-text)]" />
              <p className="min-w-0 flex-1 text-sm">
                Pré-visualizando <strong>{THEMES[previewThemeId].name}</strong> no sistema inteiro. Nada foi salvo ainda.
              </p>
              {!readOnly ? (
                <Button size="sm" onClick={() => applyTheme(previewThemeId)} loading={saveTheme.isPending}>
                  Usar este tema
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setPreviewTheme(null)}>
                Voltar ao tema atual
              </Button>
            </div>
          ) : null}

          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {THEME_IDS.map((themeId) => {
              const theme = THEMES[themeId];
              const isSaved = savedTheme === themeId;
              const isShown = activeThemeId === themeId;
              return (
                <li
                  key={themeId}
                  className={cn(
                    'flex flex-col gap-3 rounded-[var(--radius-lg)] border-2 bg-[var(--color-surface)] p-3 transition-colors',
                    isSaved ? 'border-[var(--color-brand)]' : 'border-[var(--color-border)]',
                  )}
                >
                  <ThemeThumbnail themeId={themeId} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">{theme.name}</h3>
                      <p className="text-[0.8125rem] text-[var(--color-text-muted)]">{theme.description}</p>
                    </div>
                    {isSaved ? (
                      <Badge tone="brand" className="shrink-0">
                        <Check aria-hidden className="size-3" />
                        Tema ativo
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    {!readOnly ? (
                      <Button
                        size="sm"
                        variant={isSaved ? 'secondary' : 'primary'}
                        disabled={isSaved}
                        loading={saveTheme.isPending && saveTheme.variables?.theme === themeId}
                        onClick={() => applyTheme(themeId)}
                        aria-label={`Usar o tema ${theme.name}`}
                      >
                        {isSaved ? 'Em uso' : 'Usar este tema'}
                      </Button>
                    ) : null}
                    {!isSaved ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye className="size-3.5" />}
                        aria-pressed={isShown && previewThemeId === themeId}
                        onClick={() => setPreviewTheme(previewThemeId === themeId ? null : themeId)}
                      >
                        {previewThemeId === themeId ? 'Parar prévia' : 'Ver no sistema'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {readOnly ? (
            <p className="mt-4 text-[0.8125rem] text-[var(--color-text-muted)]">
              Somente o proprietário pode trocar o tema. Você pode pré-visualizar os temas.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Marca do pet shop" description="Logo e cor própria, combinados com o tema escolhido." />
        <CardBody>
          <form onSubmit={handleBrandSubmit} noValidate className="flex flex-col gap-4">
            <TextField
              label="URL do logo"
              name="logoUrl"
              type="url"
              defaultValue={tenant.logoUrl ?? ''}
              placeholder="https://seusite.com.br/logo.png"
              hint="Imagem quadrada, de preferência com fundo transparente."
              disabled={readOnly}
              error={brandError?.fieldError('logoUrl')}
            />

            <fieldset className="flex flex-col gap-2" disabled={readOnly}>
              <legend className="mb-1 text-[0.8125rem] font-medium">Cor principal</legend>
              {(
                [
                  { value: 'theme', label: `Usar a cor do tema (${THEMES[savedTheme].name})` },
                  { value: 'custom', label: 'Usar a cor do meu pet shop' },
                ] as { value: BrandColorMode; label: string }[]
              ).map((option) => (
                <label key={option.value} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="brandColorMode"
                    value={option.value}
                    checked={brandMode === option.value}
                    onChange={() => setBrandMode(option.value)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            {brandMode === 'custom' ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="primaryColor" className="text-[0.8125rem] font-medium">
                  Cor do pet shop
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="primaryColor"
                    type="color"
                    value={color}
                    disabled={readOnly}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-9.5 w-14 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1"
                  />
                  <output className="tabular text-sm text-[var(--color-text-muted)]">{color}</output>
                  <span
                    aria-hidden
                    className="ml-auto rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem] font-medium text-white"
                    style={{ backgroundColor: color }}
                  >
                    Prévia
                  </span>
                </div>
                {colorContrast !== null && colorContrast < WCAG_AA_TEXT ? (
                  <p className="flex items-start gap-1.5 text-[0.8125rem] text-[var(--color-warning)]">
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    Cor clara demais para texto branco nos botões (contraste {colorContrast.toLocaleString('pt-BR')}:1; o
                    recomendado é 4,5:1). Prefira um tom mais escuro.
                  </p>
                ) : null}
                <p className="text-[0.8125rem] text-[var(--color-text-subtle)]">
                  O tema continua definindo fundos, navegação e estados. Os gráficos mantêm a própria paleta, legível para
                  quem tem daltonismo.
                </p>
              </div>
            ) : null}

            {!readOnly ? (
              <div className="flex justify-end">
                <Button type="submit" loading={brand.isPending}>
                  Salvar marca
                </Button>
              </div>
            ) : null}
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
