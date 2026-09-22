import { LIMIT_KEY_LABELS } from '@petflow/contracts';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { PageHeader } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { TeamSection } from '@/features/settings/TeamSection';

export function EquipePage() {
  const { session } = useSession();
  const usage = session?.billing.usage.users;

  return (
    <>
      <PageHeader title="Equipe" description="Quem tem acesso ao sistema e o que cada pessoa pode fazer." />
      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.users} entry={usage} /> : null}
      <TeamSection />
    </>
  );
}
