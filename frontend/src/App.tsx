import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardOverviewPage } from './pages/DashboardOverviewPage.js';
import { HostelFacilityPage } from './pages/HostelFacilityPage.js';
import { RoomsInventoryPage } from './pages/RoomsInventoryPage.js';
import { StudentsPage } from './pages/StudentsPage.js';
import { BookingGroupsPage } from './pages/BookingGroupsPage.js';
import { MatchingQueuePage } from './pages/MatchingQueuePage.js';
import { PaymentsPage } from './pages/PaymentsPage.js';
import { QRIdentityPage } from './pages/QRIdentityPage.js';
import { RenewalsPage } from './pages/RenewalsPage.js';
import { AnnouncementsPage } from './pages/AnnouncementsPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { AuditLogsPage } from './pages/AuditLogsPage.js';
import { WhatsAppSimulatorPage } from './pages/WhatsAppSimulatorPage.js';
import { StudentPhotoUploadPage } from './pages/StudentPhotoUploadPage.js';
import { PhotoReviewsPage } from './pages/PhotoReviewsPage.js';
import { ResidentVerificationPage } from './pages/ResidentVerificationPage.js';
import { SecurityScannerPage } from './pages/SecurityScannerPage.js';
import { SecurityAccountsPage } from './pages/SecurityAccountsPage.js';
import { ForcePasswordChangePage } from './pages/ForcePasswordChangePage.js';

class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.setState({ failed: true });
  }
  render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto min-h-screen max-w-md bg-slate-50 p-6">
          <section className="mt-12 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-xs font-bold tracking-widest text-brand-600">HOSTELOS</p>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">The page could not be displayed. Your verification link is preserved.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Reload page
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function DashboardRouter() {
  const { user, isLoading } = useAuth();
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return window.location.pathname === '/login' ? '/' : window.location.pathname || '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          Initializing Hostel Management System...
        </div>
      </div>
    );
  }

  // This is a local student-facing simulator, not the manager dashboard or webhook.
  if (currentPath === '/demo/whatsapp') {
    return <WhatsAppSimulatorPage />;
  }

  const photoUploadMatch = currentPath.match(/^\/photo-upload\/([A-Za-z0-9_-]+)$/);
  if (photoUploadMatch) return <StudentPhotoUploadPage token={photoUploadMatch[1]} />;

  // Trailing slashes (added by some phone browsers/share sheets) must not
  // drop a deep link to the dashboard default route below.
  const verificationMatch = currentPath.match(/^\/resident-verification\/([A-Za-z0-9_-]+)\/?$/);
  if (verificationMatch) {
    return (
      <RouteErrorBoundary key={verificationMatch[1]}>
        <ResidentVerificationPage token={verificationMatch[1]} />
      </RouteErrorBoundary>
    );
  }

  if (!user) {
    return <LoginPage onDone={navigate} />;
  }

  const isManager = user.role === 'MANAGER' || !user.role;

  // Mandatory first-login password change: no navigation escape, no direct-URL
  // bypass. The flag comes from the authoritative /me record on every load,
  // so refresh preserves the restriction until the backend clears it.
  const mustChangePassword = !isManager && (user as any)?.must_change_password === true;
  if (mustChangePassword) {
    if (currentPath !== '/security/change-password') {
      window.history.replaceState({}, '', '/security/change-password');
      setCurrentPath('/security/change-password');
    }
    return <ForcePasswordChangePage onDone={navigate} />;
  }

  // SECURITY staff get a scanner-only experience: no manager navigation.
  if (!isManager) {
    if (currentPath === '/security/scan') return <SecurityScannerPage />;
    // QR deep links stay reachable so a scanned pass completes after sign-in.
    if (!verificationMatch) {
      window.history.replaceState({}, '', '/security/scan');
      setCurrentPath('/security/scan');
      return <SecurityScannerPage />;
    }
  } else if (currentPath === '/security/scan') {
    return (
      <Layout currentPath={currentPath} onNavigate={navigate}>
        <SecurityScannerPage />
      </Layout>
    );
  }

  const renderCurrentPage = () => {
    switch (currentPath) {
      case '/':
        return <DashboardOverviewPage onNavigate={navigate} />;
      case '/male-hostel':
        return <HostelFacilityPage hostelCode="MALE" onNavigate={navigate} />;
      case '/female-hostel':
        return <HostelFacilityPage hostelCode="FEMALE" onNavigate={navigate} />;
      case '/rooms':
        return <RoomsInventoryPage />;
      case '/students':
        return <StudentsPage />;
      case '/photo-reviews':
        return <PhotoReviewsPage />;
      case '/groups':
        return <BookingGroupsPage />;
      case '/matching-queue':
        return <MatchingQueuePage />;
      case '/payments':
        return <PaymentsPage />;
      case '/qr-identity':
        return <QRIdentityPage />;
      case '/renewals':
        return <RenewalsPage />;
      case '/announcements':
        return <AnnouncementsPage />;
      case '/reports':
        return <ReportsPage />;
      case '/audit-logs':
        return <AuditLogsPage />;
      case '/security-accounts':
        return <SecurityAccountsPage />;
      case '/whatsapp':
        return <WhatsAppSimulatorPage />;
      default:
        return <DashboardOverviewPage onNavigate={navigate} />;
    }
  };

  return (
    <Layout currentPath={currentPath} onNavigate={navigate}>
      {renderCurrentPage()}
    </Layout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <DashboardRouter />
    </AuthProvider>
  );
}

export default App;
