-- =============================================================================
-- 0005 - Atualizacao do preco do plano PRO
--
-- Preco de oferta atualizado de R$ 99,90 para R$ 197,97. So o valor muda --
-- nenhuma coluna, constraint ou regra de negocio e alterada. O preco nunca e
-- hardcoded no frontend (ver PlanPrice em PricingPage.tsx e formatMoney):
-- tudo consome plans.price_cents via GET /api/plans, entao esta e a UNICA
-- linha que precisa mudar para o novo valor aparecer em todo lugar.
--
-- UPDATE simples, idempotente por natureza (reaplicar produz o mesmo
-- resultado) -- nao precisa de guarda extra como o ON CONFLICT da 0003.
-- =============================================================================

UPDATE plans SET price_cents = 19797 WHERE code = 'PRO';
