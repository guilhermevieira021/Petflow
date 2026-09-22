import { Permission } from '@petflow/contracts';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth, RequireGuest, RequirePermission } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordRecoveryPages';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { AgendaPage } from '@/features/appointments/AgendaPage';
import { BillingPage } from '@/features/billing/BillingPage';
import { UpgradePage } from '@/features/billing/UpgradePage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { CustomersListPage } from '@/features/customers/CustomersListPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { EquipePage } from '@/features/equipe/EquipePage';
import { LandingPage } from '@/features/landing/LandingPage';
import { MessagesPage } from '@/features/messages/MessagesPage';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { PetDetailPage } from '@/features/pets/PetDetailPage';
import { PetsListPage } from '@/features/pets/PetsListPage';
import { PricingPage } from '@/features/pricing/PricingPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { RetentionPage } from '@/features/retention/RetentionPage';
import { ServicesPage } from '@/features/services/ServicesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

/**
 * Rotas em portugues: a URL tambem e interface.
 *
 * Os guardas aqui sao conveniencia de navegacao. Quem apagar um <RequireAuth>
 * pelo DevTools apenas consegue renderizar uma tela vazia -- o backend recusa
 * toda chamada sem sessao, sem permissao ou com o acesso bloqueado (trial
 * vencido). Ver ALLOWED_WHEN_BLOCKED em AppLayout para o gate de paywall.
 */
export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/planos', element: <PricingPage /> },
  {
    element: <RequireGuest />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/criar-conta', element: <RegisterPage /> },
      { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
    ],
  },
  // Redefinicao de senha fica fora do RequireGuest: uma pessoa logada pode
  // precisar usar o link recebido por email.
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      // Onboarding e o paywall ficam FORA do AppLayout de proposito: sao
      // telas de fluxo unico, sem sidebar competindo pela atencao.
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/upgrade', element: <UpgradePage /> },
      {
        element: <AppLayout />,
        children: [
          { path: '/painel', element: <DashboardPage /> },
          {
            path: '/agenda',
            element: (
              <RequirePermission permission={Permission.APPOINTMENTS_READ}>
                <AgendaPage />
              </RequirePermission>
            ),
          },
          {
            path: '/clientes',
            element: (
              <RequirePermission permission={Permission.CUSTOMERS_READ}>
                <CustomersListPage />
              </RequirePermission>
            ),
          },
          {
            path: '/clientes/:id',
            element: (
              <RequirePermission permission={Permission.CUSTOMERS_READ}>
                <CustomerDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: '/pets',
            element: (
              <RequirePermission permission={Permission.PETS_READ}>
                <PetsListPage />
              </RequirePermission>
            ),
          },
          {
            path: '/pets/:id',
            element: (
              <RequirePermission permission={Permission.PETS_READ}>
                <PetDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: '/servicos',
            element: (
              <RequirePermission permission={Permission.SERVICES_READ}>
                <ServicesPage />
              </RequirePermission>
            ),
          },
          {
            path: '/recuperacao',
            element: (
              <RequirePermission permission={Permission.RETENTION_READ}>
                <RetentionPage />
              </RequirePermission>
            ),
          },
          {
            path: '/mensagens',
            element: (
              <RequirePermission permission={Permission.MESSAGES_READ}>
                <MessagesPage />
              </RequirePermission>
            ),
          },
          {
            path: '/relatorios',
            element: (
              <RequirePermission permission={Permission.REPORTS_READ}>
                <ReportsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/equipe',
            element: (
              <RequirePermission permission={Permission.USERS_READ}>
                <EquipePage />
              </RequirePermission>
            ),
          },
          {
            path: '/billing',
            element: (
              <RequirePermission permission={Permission.BILLING_READ}>
                <BillingPage />
              </RequirePermission>
            ),
          },
          { path: '/configuracoes', element: <SettingsPage /> },
          { path: '*', element: <Navigate to="/painel" replace /> },
        ],
      },
    ],
  },
]);
