import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sem `test.globals: true` no vitest.config.ts, a limpeza automatica do
// Testing Library entre testes nao e registrada sozinha -- sem isto, o DOM
// de um `it()` vaza para o proximo dentro do mesmo arquivo.
afterEach(() => {
  cleanup();
});
