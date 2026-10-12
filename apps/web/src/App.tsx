import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { PhoneProvider } from "./components/Softphone";
import { Spinner } from "./components/ui";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { DashboardPage } from "./pages/Dashboard";
import { InboxPage } from "./pages/Inbox";
import { ContactsPage } from "./pages/Contacts";
import { CampaignsPage } from "./pages/Campaigns";
import { PhonePage } from "./pages/Phone";
import { WhatsAppPage } from "./pages/WhatsApp";
import { AutomationsPage } from "./pages/Automations";
import { WorkflowEditorPage } from "./pages/WorkflowEditor";
import { TemplatesPage } from "./pages/Templates";
import { SettingsPage } from "./pages/Settings";

export function App() {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <PhoneProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="inbox/:id" element={<InboxPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="phone" element={<PhonePage />} />
          <Route path="whatsapp" element={<WhatsAppPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="automations/:id" element={<WorkflowEditorPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PhoneProvider>
  );
}
