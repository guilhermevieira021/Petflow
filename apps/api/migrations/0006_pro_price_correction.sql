-- =============================================================================
-- 0006 - Correcao do preco do plano PRO
--
-- A migration 0005 deixou o preco em R$ 197,97 (19797 centavos) -- o valor
-- correto de oferta e R$ 197,90 (19790 centavos). So o valor muda, mesma
-- logica da 0005: o preco nunca e hardcoded no frontend, tudo consome
-- plans.price_cents via GET /api/plans.
-- =============================================================================

UPDATE plans SET price_cents = 19790 WHERE code = 'PRO';
