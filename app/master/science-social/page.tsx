'use client';

import PfProgressDashboard from '@/app/components/PfProgressDashboard';
import { useAuth } from '@/app/context/AuthContext';

export default function SchoolOperationsDashboardPage() {
  const { profile } = useAuth();
  return <PfProgressDashboard audience="admin" schoolDashboard embedded showImportPanel={profile?.role === 'master'} />;
}
