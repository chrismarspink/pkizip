import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';
import { CreatePage } from '@/pages/CreatePage';
import { FilesTempPage } from '@/pages/FilesTempPage';
import { CertsPage } from '@/pages/CertsPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { MePage } from '@/pages/MePage';
import { TeamPage } from '@/pages/TeamPage';
import { AdminPage } from '@/pages/AdminPage';

export function App() {
  // GitHub Pages: /pkizip/ 서브 경로 지원
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/files" element={<FilesTempPage />} />
          <Route path="/certs" element={<CertsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/team/:slug" element={<TeamPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
