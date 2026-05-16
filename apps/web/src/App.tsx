import type { JSX } from 'react';
import { Route, Routes } from 'react-router';
import { CommandPalette } from './components/CommandPalette';
import { KeyboardShortcutsModal } from './components/KeyboardShortcuts';
import { ToastContainer } from './components/Toast';
import { AppShell } from './layout/AppShell';
import { Alerts } from './pages/Alerts';
import { Crons } from './pages/Crons';
import { Dashboard } from './pages/Dashboard';
import { Dashboards } from './pages/Dashboards';
import { Discover } from './pages/Discover';
import { IssueDetail } from './pages/IssueDetail';
import { IssuesList } from './pages/IssuesList';
import { Performance } from './pages/Performance';
import { Profiles } from './pages/Profiles';
import { ProjectSettings } from './pages/ProjectSettings';
import { Releases } from './pages/Releases';
import { SavedSearches } from './pages/SavedSearches';
import { SdkSetup } from './pages/SdkSetup';
import { Settings } from './pages/Settings';
import { SourceMaps } from './pages/SourceMaps';
import { TraceDetail } from './pages/TraceDetail';
import { TraceExplorer } from './pages/TraceExplorer';
import { Uptime } from './pages/Uptime';
import { AppProvider } from './state/AppContext';

export function App(): JSX.Element {
  return (
    <AppProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/issues" element={<IssuesList />} />
          <Route path="/issues/:id" element={<IssueDetail />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/traces" element={<TraceExplorer />} />
          <Route path="/traces/:id" element={<TraceDetail />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/dashboards" element={<Dashboards />} />
          <Route path="/crons" element={<Crons />} />
          <Route path="/uptime" element={<Uptime />} />
          <Route path="/releases" element={<Releases />} />
          <Route path="/source-maps" element={<SourceMaps />} />
          <Route path="/sdk-setup" element={<SdkSetup />} />
          <Route path="/saved-searches" element={<SavedSearches />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/projects/:slug" element={<ProjectSettings />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </AppShell>
      <CommandPalette />
      <KeyboardShortcutsModal />
      <ToastContainer />
    </AppProvider>
  );
}