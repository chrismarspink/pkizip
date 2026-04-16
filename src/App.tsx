import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { CreatePage } from '@/pages/CreatePage';
import { FilesTempPage } from '@/pages/FilesTempPage';
import { CertsPage } from '@/pages/CertsPage';
import { SettingsPage } from '@/pages/SettingsPage';

export function App() {
  // GitHub Pages: /pkizip/ 서브 경로 지원
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<CreatePage />} />
          <Route path="/files" element={<FilesTempPage />} />
          <Route path="/certs" element={<CertsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
