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

  const verificationMatch = currentPath.match(/^\/resident-verification\/([A-Za-z0-9_-]+)$/);
  if (verificationMatch) return <ResidentVerificationPage token={verificationMatch[1]} />;

  if (!user) {
    return <LoginPage />;
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
