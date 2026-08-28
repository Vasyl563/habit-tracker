import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useSession } from "./api/auth.js";
import { Layout } from "./components/Layout.js";
import { useI18n } from "./lib/i18n.js";
import { FeedPage } from "./pages/FeedPage.js";
import { HabitsPage } from "./pages/HabitsPage.js";
import { NotificationsPage } from "./pages/NotificationsPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SignInPage } from "./pages/SignInPage.js";
import { SignUpPage } from "./pages/SignUpPage.js";

/** Protected page: no session → redirect to /sign-in (L10 UI flow). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  const location = useLocation();
  const { t } = useI18n();
  if (isPending)
    return (
      <div className="center">
        <span className="spinner" /> {t("app.loadingSession")}
      </div>
    );
  if (!data) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/habits" replace />} />
        <Route path="/habits" element={<HabitsPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/users/:id" element={<ProfilePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/habits" replace />} />
    </Routes>
  );
}
