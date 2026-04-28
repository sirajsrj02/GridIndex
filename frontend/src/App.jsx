import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }  from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute    from './components/ProtectedRoute';
import Layout            from './components/Layout';

import Login          from './pages/Login';
import Register        from './pages/Register';
import ForgotPassword  from './pages/ForgotPassword';
import ResetPassword   from './pages/ResetPassword';
import VerifyEmail     from './pages/VerifyEmail';
import Dashboard    from './pages/Dashboard';
import GridMap      from './pages/GridMap';
import DataExplorer from './pages/DataExplorer';
import Alerts        from './pages/Alerts';
import AlertHistory  from './pages/AlertHistory';
import Profile       from './pages/Profile';
import Admin         from './pages/Admin';
import ApiDocs       from './pages/ApiDocs';
import History       from './pages/History';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login"           element={<Login />} />
            <Route path="/register"        element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password"  element={<ResetPassword />} />
            <Route path="/verify-email"    element={<VerifyEmail />} />

            {/* Protected routes — all nested under Layout */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/grid"
              element={
                <ProtectedRoute>
                  <Layout>
                    <GridMap />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/explorer"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DataExplorer />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/alerts"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Alerts />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/alerts/history"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AlertHistory />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/profile"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Profile />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Price History */}
            <Route
              path="/dashboard/history"
              element={
                <ProtectedRoute>
                  <Layout>
                    <History />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* API Docs */}
            <Route
              path="/dashboard/docs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ApiDocs />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Admin — only accessible to is_admin customers */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute adminOnly>
                  <Layout>
                    <Admin />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Redirects */}
            <Route path="/"   element={<Navigate to="/dashboard" replace />} />
            <Route path="*"   element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
