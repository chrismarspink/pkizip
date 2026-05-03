import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { UpdateBanner } from '@/components/UpdateBanner';
import { HomePage } from '@/pages/HomePage';
import { CreatePage } from '@/pages/CreatePage';
import { FilesTempPage } from '@/pages/FilesTempPage';
import { ExplorerPage } from '@/pages/ExplorerPage';
import { CertsPage } from '@/pages/CertsPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { MePage } from '@/pages/MePage';
import { AdminPage } from '@/pages/AdminPage';
import { TeamLayout } from '@/components/team/TeamLayout';
import { TeamDashboardPage } from '@/pages/team/TeamDashboardPage';
import { TeamMembersPage } from '@/pages/team/TeamMembersPage';
import { TeamInvitesPage } from '@/pages/team/TeamInvitesPage';
import { TeamContactsPage } from '@/pages/team/TeamContactsPage';
import { TeamPoliciesPage } from '@/pages/team/TeamPoliciesPage';
import { TeamAuditPage } from '@/pages/team/TeamAuditPage';
import { TeamBillingPage } from '@/pages/team/TeamBillingPage';
import { TeamSettingsPage } from '@/pages/team/TeamSettingsPage';

export function App() {
  // GitHub Pages: /pkizip/ 서브 경로 지원
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

  return (
    <BrowserRouter basename={basename}>
      <UpdateBanner />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/files" element={<FilesTempPage />} />
          <Route path="/certs" element={<CertsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/team/:slug" element={<TeamLayout />}>
            <Route index element={<TeamDashboardPage />} />
            <Route path="members" element={<TeamMembersPage />} />
            <Route path="invites" element={<TeamInvitesPage />} />
            <Route path="contacts" element={<TeamContactsPage />} />
            <Route path="policies" element={<TeamPoliciesPage />} />
            <Route path="audit" element={<TeamAuditPage />} />
            <Route path="settings" element={<TeamSettingsPage />} />
            <Route path="billing" element={<TeamBillingPage />} />
          </Route>
          {/* 매칭 안 되는 경로는 홈으로 — 옛 SW 캐시 + 새 라우트 충돌 시 빈 화면 방지 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
