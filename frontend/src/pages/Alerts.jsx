import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAlerts, createAlert, updateAlert, deleteAlert, testWebhook } from '../api/alerts';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AlertModal from '../components/AlertModal';
import ConfirmModal from '../components/ConfirmModal';
import Spinner from '../components/Spinner';

const TYPE_LABELS = {
  price_above:     'Price above',
  price_below:     'Price below',
  pct_change:      '% change',
  carbon_above:    'Carbon above',
  renewable_below: 'Renewable below',
};
const TYPE_BADGE = {
  price_above:     'badge-red',
  price_below:     'badge-blue',
  pct_change:      'badge-yellow',
  carbon_above:    'badge-yellow',
  renewable_below: 'badge-green',
};

function thresholdDisplay(alert) {
  switch (alert.alert_type) {
    case 'price_above':
    case 'price_below':
      return alert.threshold_price_mwh != null ? `$${Number(alert.threshold_price_mwh).toFixed(2)}/MWh` : '—';
    case 'pct_change':
      return alert.threshold_pct_change != null ? `${alert.threshold_pct_change}% in ${alert.threshold_timewindow_minutes}min` : '—';
    case 'carbon_above':
      return alert.threshold_carbon_g_kwh != null ? `${Number(alert.threshold_carbon_g_kwh).toFixed(0)} g/kWh` : '—';
    case 'renewable_below':
      return alert.threshold_renewable_pct != null ? `${alert.threshold_renewable_pct}%` : '—';
    default:
      return '—';
  }
}

export default function Alerts() {
  const { customer } = useAuth();
  const toast = useToast();

  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen,   setModalOpen]   = useState(false);
  const [editAlert,   setEditAlert]   = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [togglingId,   setTogglingId]    = useState(null);
  const [testingId,    setTestingId]     = useState(null);

  async function load() {
    try {
      const data = await listAlerts();
      setAlerts(data);
    } catch {
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(body, id) {
    if (id) {
      const updated = await updateAlert(id, body);
      setAlerts((prev) => prev.map((a) => a.id === id ? updated : a));
      toast.success('Alert updated');
    } else {
      const created = await createAlert(body);
      setAlerts((prev) => [created, ...prev]);
      toast.success('Alert created');
      // Onboarding tracking — first alert created
      localStorage.setItem('onboarding_alert_created', 'true');
    }
  }

  function openCreate() { setEditAlert(null); setModalOpen(true); }
  function openEdit(a)  { setEditAlert(a);    setModalOpen(true); }

  function openDelete(a) { setDeleteTarget(a); setConfirmOpen(true); }
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAlert(deleteTarget.id);
      setAlerts((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      toast.success('Alert deleted');
      setConfirmOpen(false);
    } catch {
      toast.error('Failed to delete alert');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function toggleActive(alert) {
    setTogglingId(alert.id);
    try {
      const updated = await updateAlert(alert.id, { is_active: !alert.is_active });
      setAlerts((prev) => prev.map((a) => a.id === alert.id ? updated : a));
      toast.info(updated.is_active ? 'Alert enabled' : 'Alert paused');
    } catch {
      toast.error('Failed to update alert');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleTest(alert) {
    setTestingId(alert.id);
    try {
      const result = await testWebhook(alert.id);
      if (result.success) {
        toast.success(
          `Test delivered ✓ — ${alert.webhook_url?.replace(/^https?:\/\//, '').slice(0, 40)} responded ${result.data?.statusCode}`
        );
      } else {
        toast.error(
          `Test failed — ${result.data?.error || 'Unknown error'}${result.data?.statusCode ? ` (HTTP ${result.data.statusCode})` : ''}`
        );
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      toast.error(`Test failed — ${msg}`);
    } finally {
      setTestingId(null);
    }
  }

  const activeCount   = alerts.filter((a) => a.is_active).length;
  const inactiveCount = alerts.length - activeCount;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          <p className="text-gray-500 text-sm mt-1">
            {activeCount} active · {inactiveCount} paused
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard/alerts/history"
            className="btn-secondary text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            View history
          </Link>
          <button className="btn-primary" onClick={openCreate}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New alert
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && alerts.length === 0 && (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No alerts yet</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            Create an alert to get notified by email or webhook when energy prices, carbon intensity, or renewable generation cross your thresholds.
          </p>
          <button className="btn-primary" onClick={openCreate}>Create your first alert</button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {/* Alert list */}
      {!loading && alerts.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Alert</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Region</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Type</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Threshold</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Delivery</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Triggers</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {alerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div>
                      <p className="font-medium text-gray-900">
                        {alert.alert_name || `${TYPE_LABELS[alert.alert_type]} · ${alert.region_code}`}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Cooldown: {alert.cooldown_minutes}min
                      </p>
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell">
                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">{alert.region_code}</span>
                  </td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    <span className={TYPE_BADGE[alert.alert_type] || 'badge-gray'}>
                      {TYPE_LABELS[alert.alert_type]}
                    </span>
                  </td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    <span className="font-mono text-xs text-gray-700">{thresholdDisplay(alert)}</span>
                  </td>
                  <td className="px-5 py-4 hidden xl:table-cell">
                    <span className="capitalize text-xs text-gray-600">
                      {alert.delivery_method === 'email' ? `📧 ${alert.email_address || 'email'}` : `🔗 webhook`}
                    </span>
                  </td>
                  <td className="px-5 py-4 hidden xl:table-cell">
                    <span className="text-xs text-gray-600">{alert.trigger_count || 0} times</span>
                    {alert.last_triggered_at && (
                      <p className="text-xs text-gray-400">
                        Last: {new Date(alert.last_triggered_at).toLocaleDateString()}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => toggleActive(alert)}
                      disabled={togglingId === alert.id}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        alert.is_active ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                    >
                      {togglingId === alert.id ? (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Spinner size="sm" color={alert.is_active ? 'white' : 'gray'} />
                        </span>
                      ) : (
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          alert.is_active ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Test button — webhook alerts only */}
                      {alert.delivery_method === 'webhook' && (
                        <button
                          onClick={() => handleTest(alert)}
                          disabled={testingId === alert.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                          title="Send test webhook"
                        >
                          {testingId === alert.id ? (
                            <Spinner size="sm" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(alert)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openDelete(alert)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info box */}
      {!loading && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
          <strong>How alerts work:</strong> The alert engine evaluates your active alerts after each data poll (every 5 minutes).
          When a threshold is crossed and the cooldown has elapsed, you'll receive an email or webhook payload immediately.
        </div>
      )}

      <AlertModal
        open={modalOpen}
        alert={editAlert}
        allowedRegions={customer?.allowed_regions}
        customerPlan={customer?.plan}
        onSave={handleSave}
        onClose={() => setModalOpen(false)}
      />

      <ConfirmModal
        open={confirmOpen}
        title="Delete alert"
        message={`Are you sure you want to permanently delete "${deleteTarget?.alert_name || 'this alert'}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
