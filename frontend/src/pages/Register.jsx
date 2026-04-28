import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register as apiRegister } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';

export default function Register() {
  const { login } = useAuth();
  const toast     = useToast();
  const navigate  = useNavigate();

  const [form, setForm]     = useState({ email: '', password: '', full_name: '', company_name: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, _global: undefined }));
  }

  function validate() {
    const e = {};
    if (!form.email)    e.email    = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Must be at least 8 characters';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    try {
      const data = await apiRegister(form);
      login(data.token, data.customer);
      toast.success('Account created! Check your email to verify your address.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || 'Registration failed. Please try again.';
      setErrors({ _global: msg });
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">Start for free.<br />Scale when ready.</h1>
          <p className="text-slate-400 text-lg leading-relaxed mb-10">
            Get your API key instantly. 1,000 free calls per month. No credit card required.
          </p>
          <div className="space-y-3">
            {[
              '✓  API key delivered instantly',
              '✓  Access to all 8 US grid operators',
              '✓  Real-time & historical data',
              '✓  Webhook & email alerts included',
            ].map((f) => <p key={f} className="text-slate-300 text-sm">{f}</p>)}
          </div>
        </div>
        <p className="text-slate-600 text-sm">© {new Date().getFullYear()} GridIndex · gridindex.io</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md animate-fade-in">
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-gray-900 font-bold text-xl">GridIndex</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h2>
          <p className="text-gray-500 text-sm mb-8">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-700 font-medium hover:underline">Sign in</Link>
          </p>

          {errors._global && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-6">
              {errors._global}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Full name</label>
                <input className="input" placeholder="Alex Johnson" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
              </div>
              <div>
                <label className="label">Company</label>
                <input className="input" placeholder="Acme Energy Co." value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Email address <span className="text-red-500">*</span></label>
              <input
                type="email"
                className={`input ${errors.email ? 'input-error' : ''}`}
                placeholder="you@company.com"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="label">Password <span className="text-red-500">*</span></label>
              <input
                type="password"
                className={`input ${errors.password ? 'input-error' : ''}`}
                placeholder="Min 8 characters"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
            </div>

            <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
              {loading ? <Spinner size="sm" color="white" /> : 'Create account — it\'s free'}
            </button>

            <p className="text-center text-xs text-gray-400">
              By signing up you agree to our{' '}
              <a href="https://gridindex.io/terms" className="underline hover:text-gray-600">Terms of Service</a>
              {' '}and{' '}
              <a href="https://gridindex.io/privacy" className="underline hover:text-gray-600">Privacy Policy</a>.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
