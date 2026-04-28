import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmail } from '../api/auth';
import Spinner from '../components/Spinner';

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconSuccess() {
  return (
    <svg className="w-16 h-16 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconError() {
  return (
    <svg className="w-16 h-16 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconMissing() {
  return (
    <svg className="w-16 h-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VerifyEmail() {
  const [searchParams]      = useSearchParams();
  const token               = searchParams.get('token');
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error' | 'missing'

  useEffect(() => {
    if (!token) {
      setStatus('missing');
      return;
    }

    verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  // ── States ─────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <Page>
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" />
          <p className="text-gray-500 text-sm">Verifying your email address…</p>
        </div>
      </Page>
    );
  }

  if (status === 'success') {
    return (
      <Page>
        <div className="flex flex-col items-center gap-5 text-center">
          <IconSuccess />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Email verified!</h1>
            <p className="text-gray-500 text-sm">
              Your address has been confirmed. You now have full access to GridIndex.
            </p>
          </div>
          <Link to="/dashboard" className="btn-primary mt-2">
            Go to dashboard →
          </Link>
        </div>
      </Page>
    );
  }

  if (status === 'error') {
    return (
      <Page>
        <div className="flex flex-col items-center gap-5 text-center">
          <IconError />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Link expired or invalid</h1>
            <p className="text-gray-500 text-sm">
              This verification link is no longer valid. Links expire after 24 hours.
              Sign in and request a new link from your dashboard.
            </p>
          </div>
          <div className="flex gap-3 mt-2">
            <Link to="/login" className="btn-secondary">Sign in</Link>
            <Link to="/dashboard" className="btn-primary">Go to dashboard</Link>
          </div>
        </div>
      </Page>
    );
  }

  // 'missing' — no token in URL
  return (
    <Page>
      <div className="flex flex-col items-center gap-5 text-center">
        <IconMissing />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">No verification token</h1>
          <p className="text-gray-500 text-sm">
            This link is incomplete. Use the link from your verification email, or
            request a new one from your dashboard.
          </p>
        </div>
        <Link to="/dashboard" className="btn-primary mt-2">
          Go to dashboard →
        </Link>
      </div>
    </Page>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function Page({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span className="text-gray-900 font-bold text-xl tracking-tight">GridIndex</span>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-10 animate-fade-in">
        {children}
      </div>
    </div>
  );
}
