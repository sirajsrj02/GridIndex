import React, { useState, useEffect } from 'react';
import { getProfile } from '../api/dashboard';
import { rotateApiKey, updateProfile } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import Spinner from '../components/Spinner';

const PLAN_FEATURES = {
  starter:    { calls: '1,000',    history: '7 days',   alerts: '5',   webhook: false, color: 'gray'   },
  pro:        { calls: '100,000',  history: '90 days',  alerts: '50',  webhook: true,  color: 'blue'   },
  enterprise: { calls: '1,000,000', history: '2 years', alerts: '500', webhook: true,  color: 'purple' },
};

function CopyButton({ text, label = 'Copy', dark = false, onCopy }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 2000);
  }
  const base = dark
    ? 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'
    : 'bg-white hover:bg-gray-50 text-gray-600 border-gray-300';
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${base}`}
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

export default function Profile() {
  const { customer, refreshCustomer } = useAuth();
  const toast = useToast();

  const [profile,        setProfile]       = useState(null);
  const [loading,        setLoading]       = useState(true);
  const [apiKeyVisible,  setApiKeyVisible] = useState(false);
  const [rotateOpen,     setRotateOpen]    = useState(false);
  const [rotateLoading,  setRotateLoading] = useState(false);
  const [newKey,         setNewKey]        = useState(null);

  // Notification prefs — local state mirrors what's in the DB
  const defaultPrefs = { usage_warnings: true, alert_emails: true, product_emails: true };
  const [notifPrefs, setNotifPrefs] = useState(defaultPrefs);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        // Merge DB prefs over defaults — handles old accounts that don't have the column yet
        if (p?.notification_prefs) {
          setNotifPrefs({ ...defaultPrefs, ...p.notification_prefs });
        }
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  async function handleRotate() {
    setRotateLoading(true);
    try {
      const data = await rotateApiKey();
      setNewKey(data.api_key);
      setApiKeyVisible(true);
      setRotateOpen(false);
      await refreshCustomer();
      toast.success('API key rotated successfully. Update your integrations.');
    } catch {
      toast.error('Failed to rotate API key');
    } finally {
      setRotateLoading(false);
    }
  }

  async function handleTogglePref(key) {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);  // optimistic
    setSavingPrefs(true);
    try {
      const updated = await updateProfile({ notification_prefs: { [key]: next[key] } });
      if (updated?.notification_prefs) {
        setNotifPrefs({ ...defaultPrefs, ...updated.notification_prefs });
      }
    } catch {
      // Revert on failure
      setNotifPrefs(notifPrefs);
      toast.error('Failed to save preference');
    } finally {
      setSavingPrefs(false);
    }
  }

  const displayKey = newKey || profile?.api_key || customer?.api_key || '';
  const maskedKey  = displayKey ? `${displayKey.slice(0, 8)}${'•'.repeat(24)}` : '';
  const plan       = profile?.plan || customer?.plan || 'starter';
  const planInfo   = PLAN_FEATURES[plan] || PLAN_FEATURES.starter;

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile & API Key</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your account details and API credentials.</p>
      </div>

      {/* API Key card */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">API Key</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pass this as <code className="bg-gray-100 px-1 rounded">X-API-Key</code> header on every request.
            </p>
          </div>
          {newKey && (
            <span className="badge-green animate-slide-down">New key active</span>
          )}
        </div>

        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <code className="flex-1 text-sm font-mono text-gray-800 select-all break-all">
            {apiKeyVisible ? displayKey : maskedKey}
          </code>
          <button
            onClick={() => setApiKeyVisible((v) => !v)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            title={apiKeyVisible ? 'Hide key' : 'Show key'}
          >
            {apiKeyVisible ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
            )}
          </button>
          <CopyButton
            text={displayKey}
            label="Copy key"
            onCopy={() => localStorage.setItem('onboarding_api_key_copied', 'true')}
          />
        </div>

        {profile?.api_key_created_at && (
          <p className="text-xs text-gray-400 mt-2">
            Created {new Date(profile.api_key_created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
          <button
            className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => setRotateOpen(true)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Rotate key
          </button>
          <p className="text-xs text-gray-400">Rotating generates a new key and immediately invalidates the current one.</p>
        </div>
      </div>

      {/* Quick start */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Quick start</h2>
        <div className="relative group">
          <pre className="bg-slate-900 text-slate-200 text-xs rounded-xl p-4 pr-24 overflow-x-auto leading-relaxed">
{`curl "https://api.gridindex.io/api/v1/prices/latest?region=CAISO" \\
  -H "X-API-Key: ${apiKeyVisible ? displayKey : maskedKey}"`}
          </pre>
          <div className="absolute top-3 right-3">
            <CopyButton
              text={`curl "https://api.gridindex.io/api/v1/prices/latest?region=CAISO" -H "X-API-Key: ${displayKey}"`}
              label="Copy"
              dark
            />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Full API reference →{' '}
          <a href="https://gridindex.io/docs" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
            gridindex.io/docs
          </a>
        </p>
      </div>

      {/* Plan & limits */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Plan & Limits</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          {[
            { label: 'Plan', value: <span className="capitalize font-bold">{plan}</span> },
            { label: 'Monthly calls', value: planInfo.calls },
            { label: 'History access', value: planInfo.history },
            { label: 'Max alerts', value: planInfo.alerts },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-base font-semibold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 text-sm">
          <div className={`flex items-center gap-2 ${planInfo.webhook ? 'text-green-600' : 'text-gray-400'}`}>
            {planInfo.webhook
              ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            }
            Webhook alerts
          </div>
          <div className="flex items-center gap-2 text-green-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
            All 8 grid operators
          </div>
        </div>

        {plan === 'starter' && (
          <div className="mt-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-900">Ready to scale?</p>
            <p className="text-xs text-blue-700 mt-0.5 mb-3">Upgrade to Pro for 100× more calls, 90-day history, and webhook alerts.</p>
            <a href="https://gridindex.io/pricing" target="_blank" rel="noopener noreferrer" className="btn-primary text-xs">
              View pricing →
            </a>
          </div>
        )}
      </div>

      {/* Account details */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Account Details</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          {[
            { label: 'Full name',    value: profile?.full_name    || '—' },
            { label: 'Company',      value: profile?.company_name || '—' },
            { label: 'Email',        value: profile?.email        || '—' },
            { label: 'Member since', value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—' },
            { label: 'Last active',  value: profile?.last_seen_at ? new Date(profile.last_seen_at).toLocaleString() : '—' },
            { label: 'Regions',      value: profile?.allowed_regions?.join(', ') || '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-gray-500 mb-0.5">{label}</dt>
              <dd className="font-medium text-gray-900 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Notification preferences */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Notification Preferences</h2>
            <p className="text-xs text-gray-500 mt-0.5">Control which emails GridIndex sends you.</p>
          </div>
          {savingPrefs && <Spinner size="sm" />}
        </div>
        <div className="divide-y divide-gray-100">
          {[
            {
              key:   'usage_warnings',
              label: 'Usage warnings',
              desc:  'Email me when I reach 80% and 95% of my monthly API call limit.',
            },
            {
              key:   'alert_emails',
              label: 'Alert notifications',
              desc:  'Receive email notifications when my price or grid alerts fire.',
            },
            {
              key:   'product_emails',
              label: 'Product & feature updates',
              desc:  'Occasional emails about new GridIndex features, API changes, and announcements.',
            },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between py-4 gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
              <button
                onClick={() => handleTogglePref(key)}
                disabled={savingPrefs}
                className={`relative inline-flex flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 ${
                  notifPrefs[key] ? 'bg-blue-600' : 'bg-gray-200'
                }`}
                title={notifPrefs[key] ? 'Click to disable' : 'Click to enable'}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  notifPrefs[key] ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <ConfirmModal
        open={rotateOpen}
        title="Rotate API key?"
        message="This will immediately invalidate your current key and generate a new one. Any existing integrations using the old key will stop working until updated."
        confirmLabel="Yes, rotate key"
        danger
        loading={rotateLoading}
        onConfirm={handleRotate}
        onCancel={() => setRotateOpen(false)}
      />
    </div>
  );
}
