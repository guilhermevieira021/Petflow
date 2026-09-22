import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Junta classes condicionais e resolve conflitos do Tailwind.
 * `cn('p-2', 'p-4')` devolve 'p-4' -- o que permite que um componente aceite
 * `className` do chamador sem que as classes briguem entre si.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
