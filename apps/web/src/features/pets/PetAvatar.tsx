import type { PetSpecies } from '@petflow/contracts';
import { Bird, Cat, Dog, PawPrint, Rabbit, Turtle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

const SPECIES_ICONS: Record<PetSpecies, LucideIcon> = {
  DOG: Dog,
  CAT: Cat,
  BIRD: Bird,
  RODENT: Rabbit,
  REPTILE: Turtle,
  OTHER: PawPrint,
};

/**
 * Avatar do pet. Ainda nao existe foto de pet no backend -- o icone da
 * especie da identidade visual sem inventar imagem. Quando a foto existir,
 * este e o unico lugar que precisa mudar.
 */
export function PetAvatar({
  species,
  name,
  size = 'md',
  className,
}: {
  species: PetSpecies;
  name: string;
  size?: 'md' | 'xl';
  className?: string;
}) {
  const Icon = SPECIES_ICONS[species] ?? PawPrint;
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]',
        size === 'xl' ? 'size-20 rounded-[var(--radius-xl)]' : 'size-12 rounded-[var(--radius-md)]',
        className,
      )}
    >
      <Icon aria-hidden className={size === 'xl' ? 'size-9' : 'size-6'} strokeWidth={1.75} />
    </span>
  );
}
