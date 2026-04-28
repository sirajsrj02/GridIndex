import React, { useState, useEffect } from 'react';
import Spinner from './Spinner';

const REGIONS  = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];
const TYPES    = ['price_above', 'price_below', 'pct_change', 'carbon_above', 'renewable_below'];
const DELIVERY = ['email', 'webhook'];

const TYPE_LABELS = {
  price_above:     'Price above threshold',
  price_below:     'Price below threshold',
  pct_change:      'Price % change within window',
  carbon_above:    'Carbon intensity above threshold',
  renewable_below: 'Renewable generation below threshold',
};

const TYPE_THRESHOLD = {
  price_above:     { field: 'threshold_price_mwh',     label: 'Threshold ($/MWh)',    placeholder: '150' },
  price_below:     { field: 'threshold_price_mwh',     label: 'Threshold ($/MWh)',    placeholder: '20' },
  pct_change:      { field: 'threshold_pct_change',    label: 'Change % trigger',     placeholder: '20' },
  carbon_above:    { field: 'threshold_carbon_g_kwh',  label: 'Threshold (g/kWh)',    placeholder: '400' },
  renewable_below: { field: 'threshold_renewable_pct', label: 'Threshold (%)',         placeholder: '30' },
};

const EMPTY = {
  alert_name:                   '',
  region_code:                  'CAISO',
  alert_type:                   'price_above',
  threshold_price_mwh:          '',
  threshold_pct_change:         '',
  threshold_timewindow_minutes: '5',
  threshold_carbon_g_kwh:       '',
  threshold_renewable_pct:      '',
  delivery_method:              'email',
  email_address:                '',
  webhook_url:                  '',
  webhook_secret:               '',
  cooldown_minutes:             '60',
};

const WEBHOOK_PLANS = ['pro', 'developer', 'enterprise'];

export default function AlertModal({ open, alert, allowedRegions, customerPlan, onSave, onClose }) {
  const [form, setForm]     = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const isEdit = Boolean(alert?.id);

  useEffect(() => {
    if (!open) return;
    if (alert) {
      setForm({
        alert_name:                   alert.alert_name || '',
        region_code:                  alert.region_code || 'CAISO',
        alert_type:                   alert.alert_type || 'price_above',
        threshold_price_mwh:          alert.threshold_price_mwh ?? '',
        threshold_pct_change:         alert.threshold_pct_change ?? '',
        threshold_timewindow_minutes: alert.threshold_timewindow_minutes ?? '5',
        threshold_carbon_g_kwh:       alert.threshold_carbon_g_kwh ?? '',
        threshold_renewable_pct:      alert.threshold_renewable_pct ?? '',
        delivery_method:              alert.delivery_method || 'email',
        email_address:                alert.email_address || '',
        webhook_url:                  alert.webhook_url || '',
        webhook_secret:               alert.webhook_secret || '',
        cooldown_minutes:             alert.cooldown_minutes ?? '60',
      });
    } else {
      setForm(EMPTY);
    }
    setErrors({});
  }, [open, alert]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate() {
    const e = {};
    const thr = TYPE_THRESHOLD[form.alert_type];
    if (!form.region_code)    e.region_code   = 'Required';
    if (!form.alert_type)     e.alert_type    = 'Required';
    if (!form[thr.field])     e[thr.field]    = 'Required for this alert type';
    if (form.delivery_method === 'email'   && !form.email_address)  e.email_address = 'Required for email delivery';
    if (form.delivery_method === 'webhook' && !form.webhook_url)    e.webhook_url   = 'Required for webhook delivery';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const thr = TYPE_THRESHOLD[form.alert_type];
    const body = {
      alert_name:       form.alert_name || undefined,
      region_code:      form.region_code,
      alert_type:       form.alert_type,
      delivery_method:  form.delivery_method,
      cooldown_minutes: Number(form.cooldown_minutes) || 60,
      [thr.field]:      Number(form[thr.field]),
    };
    if (form.alert_type === 'pct_change') {
      body.threshold_timewindow_minutes = Number(form.threshold_timewindow_minutes) || 5;
    }
    if (form.delivery_method === 'email')   body.email_address  = form.email_address;
    if (form.delivery_method === 'webhook') {
      body.webhook_url = form.webhook_url;
      if (form.webhook_secret) body.webhook_secret = form.webhook_secret;
    }

    setLoading(true);
    try {
      await onSave(body, alert?.id);
      onClose();
    } catch (err) {
      setErrors({ _global: err.response?.data?.error || err.message });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const thr = TYPE_THRESHOLD[form.alert_type];
  const availableRegions  = allowedRegions?.length ? allowedRegions : REGIONS;
  const webhookRestricted = form.delivery_method === 'webhook' && customerPlan !== undefined && !WEBHOOK_PLANS.includes(customerPlan);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Alert' : 'Create Alert'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {errors._global && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {errors._global}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="label">Alert name <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input" placeholder="e.g. CAISO spike alert" value={form.alert_name} onChange={(e) => set('alert_name', e.target.value)} />
          </div>

          {/* Region + Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Region <span className="text-red-500">*</span></label>
              <select className={`input ${errors.region_code ? 'input-error' : ''}`} value={form.region_code} onChange={(e) => set('region_code', e.target.value)}>
                {availableRegions.map((r) => <option key={r}>{r}</option>)}
              </select>
              {errors.region_code && <p className="text-red-500 text-xs mt-1">{errors.region_code}</p>}
            </div>
            <div>
              <label className="label">Alert type <span className="text-red-500">*</span></label>
              <select className="input" value={form.alert_type} onChange={(e) => set('alert_type', e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          {/* Dynamic threshold field */}
          <div className={`grid gap-4 ${form.alert_type === 'pct_change' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label className="label">{thr.label} <span className="text-red-500">*</span></label>
              <input
                type="number"
                className={`input ${errors[thr.field] ? 'input-error' : ''}`}
                placeholder={thr.placeholder}
                value={form[thr.field]}
                onChange={(e) => set(thr.field, e.target.value)}
              />
              {errors[thr.field] && <p className="text-red-500 text-xs mt-1">{errors[thr.field]}</p>}
            </div>
            {form.alert_type === 'pct_change' && (
              <div>
                <label className="label">Time window (minutes)</label>
                <input
                  type="number"
                  className="input"
                  placeholder="5"
                  min="1"
                  max="1440"
                  value={form.threshold_timewindow_minutes}
                  onChange={(e) => set('threshold_timewindow_minutes', e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Delivery method */}
          <div>
            <label className="label">Delivery method</label>
            <div className="flex gap-3">
              {DELIVERY.map((d) => (
                <label key={d} className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  form.delivery_method === d ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input type="radio" name="delivery" value={d} checked={form.delivery_method === d} onChange={() => set('delivery_method', d)} className="hidden" />
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    form.delivery_method === d ? 'border-brand-600' : 'border-gray-300'
                  }`}>
                    {form.delivery_method === d && <span className="w-2 h-2 rounded-full bg-brand-600" />}
                  </span>
                  <span className="text-sm font-medium capitalize">{d}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Plan upgrade notice when Starter selects webhook */}
          {webhookRestricted && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div>
                <p className="font-semibold">Webhook delivery requires Pro or Enterprise</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Your current plan doesn't include webhooks.{' '}
                  <a href="https://gridindex.io/pricing" target="_blank" rel="noopener noreferrer" className="underline font-medium">Upgrade your plan →</a>
                </p>
              </div>
            </div>
          )}

          {/* Email / Webhook fields */}
          {form.delivery_method === 'email' && (
            <div>
              <label className="label">Email address <span className="text-red-500">*</span></label>
              <input type="email" className={`input ${errors.email_address ? 'input-error' : ''}`} placeholder="you@company.com" value={form.email_address} onChange={(e) => set('email_address', e.target.value)} />
              {errors.email_address && <p className="text-red-500 text-xs mt-1">{errors.email_address}</p>}
            </div>
          )}
          {form.delivery_method === 'webhook' && (
            <div className="space-y-4">
              <div>
                <label className="label">Webhook URL <span className="text-red-500">*</span></label>
                <input className={`input ${errors.webhook_url ? 'input-error' : ''}`} placeholder="https://your-server.com/hook" value={form.webhook_url} onChange={(e) => set('webhook_url', e.target.value)} />
                {errors.webhook_url && <p className="text-red-500 text-xs mt-1">{errors.webhook_url}</p>}
              </div>
              <div>
                <label className="label">Webhook secret <span className="text-gray-400 font-normal">(optional — for HMAC verification)</span></label>
                <input className="input" placeholder="my-secret-token" value={form.webhook_secret} onChange={(e) => set('webhook_secret', e.target.value)} />
              </div>
            </div>
          )}

          {/* Cooldown */}
          <div>
            <label className="label">Cooldown between alerts</label>
            <select className="input" value={form.cooldown_minutes} onChange={(e) => set('cooldown_minutes', e.target.value)}>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="360">6 hours</option>
              <option value="720">12 hours</option>
              <option value="1440">24 hours</option>
            </select>
          </div>

          {/* Footer */}
          <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading || webhookRestricted}>
              {loading && <Spinner size="sm" color="white" />}
              {isEdit ? 'Save changes' : 'Create alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
