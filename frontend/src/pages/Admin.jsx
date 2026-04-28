import React, { useEffect, useState, useCallback } from 'react';
import { getAdminStats, getCustomers, updateCustomer } from '../api/admin';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';

const PLANS = ['trial', 'starter', 'developer', 'pro', 'enterprise'];

const PLAN_BADGE = {
  trial:      'bg-gray-100 text-gray-600',
  starter:    'bg-gray-100 text-gray-700',
  developer:  'bg-blue-100 text-blue-700',
  pro:        'bg-indigo-100 text-indigo-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium text-gray-500 mb-2">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Inline plan editor ────────────────────────────────────────────────────────
function PlanCell({ customer, onSave }) {
  const [editing, setEditing] = useState(false);
  const [plan,    setPlan]    = useState(customer.plan);
  const [saving,  setSaving]  = useState(false);
  const toast = useToast();

  async function save() {
    if (plan === customer.plan) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(customer.id, { plan });
      toast.success(`Plan updated to ${plan}`);
      setEditing(false);
    } catch {
      toast.error('Failed to update plan');
      setPlan(customer.plan);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize cursor-pointer hover:opacity-80 transition-opacity ${PLAN_BADGE[customer.plan] || PLAN_BADGE.trial}`}
        title="Click to change plan"
      >
        {customer.plan}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <select
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        className="text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        autoFocus
      >
        {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <button
        onClick={save}
        disabled={saving}
        className="text-xs text-blue-600 font-semibold hover:text-blue-800"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button
        onClick={() => { setPlan(customer.plan); setEditing(false); }}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        ✕
      </button>
    </span>
  );
}

// ── Active toggle ─────────────────────────────────────────────────────────────
function ActiveToggle({ customer, onSave }) {
  const [active,  setActive]  = useState(customer.is_active);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function toggle() {
    setLoading(true);
    const next = !active;
    try {
      await onSave(customer.id, { is_active: next });
      setActive(next);
      toast.info(next ? 'Account activated' : 'Account deactivated');
    } catch {
      toast.error('Failed to update account status');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        active ? 'bg-blue-600' : 'bg-gray-200'
      }`}
      title={active ? 'Click to deactivate' : 'Click to activate'}
    >
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" color={active ? 'white' : 'gray'} />
        </span>
      ) : (
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          active ? 'translate-x-4' : 'translate-x-0.5'
        }`} />
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Admin() {
  const toast = useToast();

  const [stats,      setStats]      = useState(null);
  const [customers,  setCustomers]  = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Load stats
  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => toast.error('Failed to load stats'))
      .finally(() => setStatsLoading(false));
  }, []);

  // Load customers
  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const { customers: rows, pagination: pg } = await getCustomers({ page, q: search });
      setCustomers(rows);
      setPagination(pg);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  async function handleSave(id, patch) {
    const updated = await updateCustomer(id, patch);
    setCustomers((prev) => prev.map((c) => c.id === id ? { ...c, ...updated } : c));
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center text-white text-sm">⚙</span>
          Admin
        </h1>
        <p className="text-gray-500 text-sm mt-1">Platform overview and customer management.</p>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div className="flex justify-center py-8"><Spinner size="lg" /></div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total customers"  value={stats.customers.total.toLocaleString()}         color="blue"   />
            <StatCard label="New (last 7d)"    value={stats.customers.new_last_7d.toLocaleString()}   color="green"  />
            <StatCard label="Calls today"      value={stats.calls.today.toLocaleString()}              color="purple" />
            <StatCard label="Active alerts"    value={stats.alerts.active.toLocaleString()}            color="amber"  />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="card p-5">
              <p className="text-xs font-medium text-gray-500 mb-3">Plans</p>
              <div className="space-y-2">
                {Object.entries(stats.customers.by_plan).map(([plan, count]) => (
                  <div key={plan} className="flex items-center justify-between text-sm">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_BADGE[plan] || PLAN_BADGE.trial}`}>{plan}</span>
                    <span className="font-medium text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card p-5">
              <p className="text-xs font-medium text-gray-500 mb-3">API Calls</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">This month</span><span className="font-medium">{(stats.calls.this_month || 0).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">All time</span><span className="font-medium">{(stats.calls.all_time || 0).toLocaleString()}</span></div>
              </div>
            </div>
            <div className="card p-5">
              <p className="text-xs font-medium text-gray-500 mb-3">Verification</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Verified</span><span className="font-medium text-green-600">{stats.customers.verified}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Unverified</span><span className="font-medium text-amber-600">{stats.customers.total - stats.customers.verified}</span></div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Customer table */}
      <div className="card overflow-hidden">
        {/* Table header */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700 mr-auto">Customers</h2>
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <input
              className="input text-sm py-1.5 w-64"
              placeholder="Search email, name, company…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn-secondary text-xs py-1.5 px-3">Search</button>
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </form>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : customers.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {search ? `No customers matching "${search}"` : 'No customers yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Plan</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Calls / limit</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Last seen</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Verified</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900 text-sm">{c.full_name || '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>
                      {c.company_name && <p className="text-xs text-gray-400">{c.company_name}</p>}
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <PlanCell customer={c} onSave={handleSave} />
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <span className="font-mono text-xs text-gray-700">
                        {(c.calls_this_month || 0).toLocaleString()} / {(c.monthly_limit || 0).toLocaleString()}
                      </span>
                      <div className="w-24 bg-gray-100 rounded-full h-1 mt-1.5">
                        <div
                          className="h-1 rounded-full bg-blue-500"
                          style={{ width: `${Math.min(100, ((c.calls_this_month || 0) / (c.monthly_limit || 1)) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden xl:table-cell text-xs text-gray-500">
                      {c.last_seen_at
                        ? new Date(c.last_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'Never'}
                    </td>
                    <td className="px-5 py-4 hidden xl:table-cell">
                      {c.is_email_verified ? (
                        <span className="text-xs text-green-600 font-medium">✓ Verified</span>
                      ) : (
                        <span className="text-xs text-amber-600 font-medium">Pending</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <ActiveToggle customer={c} onSave={handleSave} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.total_pages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>{pagination.total} customers · page {pagination.page} of {pagination.total_pages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={!pagination.has_prev}
                className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!pagination.has_next}
                className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
