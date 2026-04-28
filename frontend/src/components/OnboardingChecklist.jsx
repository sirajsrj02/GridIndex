import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

// ── Step definitions ──────────────────────────────────────────────────────────
// Each step declares how to read completion state.
// `check(customer, ls)` receives the current customer object and a localStorage
// snapshot.  Return true when this step is done.
const STEPS = [
  {
    key:       'api_key_copied',
    label:     'Copy your API key',
    desc:      'Your key authenticates every API request.',
    to:        '/dashboard/profile',
    linkLabel: 'Go to Profile',
    check:     (_, ls) => ls['onboarding_api_key_copied'] === 'true',
  },
  {
    key:       'api_call_made',
    label:     'Make your first API call',
    desc:      'Hit the live endpoint from your terminal or code.',
    to:        '/dashboard/profile',
    linkLabel: 'See quick start',
    check:     (customer) => (customer?.calls_all_time || 0) > 0,
  },
  {
    key:       'map_visited',
    label:     'Explore the Grid Map',
    desc:      'Live prices and carbon data for all 8 US ISOs.',
    to:        '/dashboard/grid',
    linkLabel: 'Open Grid Map',
    check:     (_, ls) => ls['onboarding_map_visited'] === 'true',
  },
  {
    key:       'explorer_visited',
    label:     'Try the Data Explorer',
    desc:      'Query, preview, and export any dataset.',
    to:        '/dashboard/explorer',
    linkLabel: 'Open Explorer',
    check:     (_, ls) => ls['onboarding_explorer_visited'] === 'true',
  },
  {
    key:       'alert_created',
    label:     'Create your first alert',
    desc:      'Get notified by email or webhook when thresholds are crossed.',
    to:        '/dashboard/alerts',
    linkLabel: 'Create alert',
    check:     (_, ls) => ls['onboarding_alert_created'] === 'true',
  },
];

const DISMISSED_KEY = 'onboarding_dismissed';

function readLS() {
  const out = {};
  for (const s of STEPS) {
    out[`onboarding_${s.key}`] = localStorage.getItem(`onboarding_${s.key}`) ?? '';
  }
  return out;
}

export default function OnboardingChecklist({ customer }) {
  const [dismissed, setDismissed]   = useState(() => localStorage.getItem(DISMISSED_KEY) === 'true');
  const [ls,        setLs]          = useState(readLS);
  const [allDone,   setAllDone]     = useState(false);

  // Re-read localStorage on focus (user may have visited other tabs)
  const refresh = useCallback(() => setLs(readLS()), []);
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const completed = STEPS.filter((s) => s.check(customer, ls));
  const total     = STEPS.length;
  const count     = completed.length;
  const pct       = Math.round((count / total) * 100);

  // When everything is done, show a brief celebration then auto-dismiss.
  // Guard on !allDone so a re-render while already celebrating doesn't
  // start a second timer (allDone in deps ensures the effect re-runs when
  // it transitions true→false, but the condition short-circuits it).
  useEffect(() => {
    if (count === total && !dismissed && !allDone) {
      setAllDone(true);
      const t = setTimeout(() => {
        localStorage.setItem(DISMISSED_KEY, 'true');
        setDismissed(true);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [count, total, dismissed, allDone]);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  }

  if (dismissed) return null;

  // ── All-done celebration state ─────────────────────────────────────────────
  if (allDone) {
    return (
      <div className="card p-6 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-2xl">
            🎉
          </div>
          <div>
            <h3 className="text-base font-bold text-green-900">You're all set!</h3>
            <p className="text-sm text-green-700 mt-0.5">
              You've completed all the getting-started steps. Happy building!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal checklist ───────────────────────────────────────────────────────
  return (
    <div className="card overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-white">Getting started</h2>
            <p className="text-xs text-blue-200 mt-0.5">{count} of {total} complete</p>
          </div>
          <button
            onClick={dismiss}
            className="p-1.5 rounded-lg text-blue-300 hover:text-white hover:bg-blue-500 transition-colors"
            title="Dismiss"
            aria-label="Dismiss checklist"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-blue-500/40 rounded-full h-1.5">
          <div
            className="h-1.5 rounded-full bg-white transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-gray-50">
        {STEPS.map((step) => {
          const done = step.check(customer, ls);
          return (
            <div key={step.key} className={`flex items-center gap-4 px-5 py-3.5 transition-colors ${done ? 'bg-gray-50/60' : 'hover:bg-gray-50'}`}>
              {/* Circle checkbox */}
              <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-colors ${
                done
                  ? 'bg-green-500 border-green-500'
                  : 'border-gray-300 bg-white'
              }`}>
                {done && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium leading-tight ${done ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-900'}`}>
                  {step.label}
                </p>
                {!done && (
                  <p className="text-xs text-gray-400 mt-0.5">{step.desc}</p>
                )}
              </div>

              {/* Action link — only for incomplete steps */}
              {!done && (
                <Link
                  to={step.to}
                  className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
                >
                  {step.linkLabel}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                  </svg>
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
