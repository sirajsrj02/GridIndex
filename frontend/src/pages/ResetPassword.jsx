import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api/auth';
import Spinner from '../components/Spinner';

export default function ResetPassword() {
  const [searchParams]                    = useSearchParams();
  const navigate                          = useNavigate();
  const token                             = searchParams.get('token') || '';

  const [form,    setForm]    = useState({ password: '', confirm: '' });
  const [errors,  setErrors]  = useState({});
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, _global: undefined }));
  }

  function validate() {
    const e = {};
    if (!form.password)              e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (!form.confirm)               e.confirm  = 'Please confirm your password';
    else if (form.confirm !== form.password) e.confirm = 'Passwords do not match';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    if (!token) {
      setErrors({ _global: 'Reset link is missing or invalid. Please request a new one.' });
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, form.password);
      setDone(true);
      // Auto-redirect to login after 2.5 seconds
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      const msg = err.response?.data?.error || 'Reset failed. The link may have expired.';
      setErrors({ _global: msg });
    } finally {
      setLoading(false);
    }
  }

  // No token in URL — likely navigated here directly
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-md text-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Invalid reset link</h2>
          <p className="text-gray-500 text-sm mb-8">
            This link is missing a reset token. Please request a new reset link from the login page.
          </p>
          <Link to="/forgot-password" className="btn-primary inline-block py-2.5 px-6">
            Request reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-950">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">GridIndex</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Choose a new<br />password.
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Pick something strong. At least 8 characters — a mix of letters, numbers, and symbols is best.
          </p>
        </div>
        <p className="text-slate-600 text-sm">© {new Date().getFullYear()} GridIndex · gridindex.io</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-gray-900 font-bold text-xl">GridIndex</span>
          </div>

          {done ? (
            /* Success state */
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Password updated!</h2>
              <p className="text-gray-500 text-sm mb-6">
                Your password has been changed successfully. Redirecting you to sign in…
              </p>
              <Link to="/login" className="text-brand-700 text-sm font-medium hover:underline">
                Go to sign in now
              </Link>
            </div>
          ) : (
            /* Form state */
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Set new password</h2>
              <p className="text-gray-500 text-sm mb-8">
                Enter and confirm your new password below.
              </p>

              {errors._global && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-6">
                  {errors._global}{' '}
                  {errors._global.toLowerCase().includes('expired') && (
                    <Link to="/forgot-password" className="font-medium underline">
                      Request a new link
                    </Link>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div>
                  <label className="label">New password</label>
                  <input
                    type="password"
                    className={`input ${errors.password ? 'input-error' : ''}`}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                  />
                  {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
                </div>

                <div>
                  <label className="label">Confirm new password</label>
                  <input
                    type="password"
                    className={`input ${errors.confirm ? 'input-error' : ''}`}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={(e) => set('confirm', e.target.value)}
                  />
                  {errors.confirm && <p className="text-red-500 text-xs mt-1">{errors.confirm}</p>}
                </div>

                <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
                  {loading ? <Spinner size="sm" color="white" /> : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
