'use strict';

const nodemailer = require('nodemailer');
const logger = require('../config/logger').forJob('emailService');

// ── Transport ─────────────────────────────────────────────────────────────────
// In production set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
// In test (NODE_ENV=test) we create an Ethereal no-op transport so nothing is
// actually sent but the code path is fully exercised.
function createTransport() {
  if (process.env.NODE_ENV === 'test') {
    // Ethereal-style stub: just resolves immediately
    return {
      sendMail: async (opts) => ({ messageId: 'test-message-id', envelope: opts }),
      verify:   async () => true
    };
  }

  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

const transport = createTransport();
const FROM = process.env.SMTP_FROM || 'GridIndex <noreply@gridindex.io>';

// ── Helpers ───────────────────────────────────────────────────────────────────
function priceRow(label, value) {
  return value != null ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${label}</td><td style="padding:4px 0;font-weight:600;">${value}</td></tr>` : '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a welcome email after registration.
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.fullName
 * @param {string} opts.apiKey
 * @param {string} opts.plan
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendWelcomeEmail({ email, fullName, apiKey, plan }) {
  const name = escapeHtml(fullName || email.split('@')[0]);
  const subject = 'Welcome to GridIndex — your API key is ready';
  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <h1 style="font-size:24px;margin-bottom:8px;">Welcome to GridIndex, ${name}!</h1>
      <p style="color:#6b7280;">Your account is live on the <strong>${escapeHtml(plan || 'Starter')}</strong> plan.</p>

      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:24px 0;">
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Your API Key</p>
        <code style="font-size:15px;font-weight:600;color:#1d4ed8;">${apiKey}</code>
        <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Keep this secret. Rotate it any time from your dashboard.</p>
      </div>

      <h2 style="font-size:16px;">Quick start</h2>
      <pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:6px;font-size:13px;overflow-x:auto;">curl https://api.gridindex.io/api/v1/prices/latest?region=CAISO \\
  -H "X-API-Key: ${apiKey}"</pre>

      <p style="color:#6b7280;font-size:14px;">Docs: <a href="https://gridindex.io/docs" style="color:#1d4ed8;">gridindex.io/docs</a> · Dashboard: <a href="https://app.gridindex.io" style="color:#1d4ed8;">app.gridindex.io</a></p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;" />
      <p style="font-size:12px;color:#9ca3af;">GridIndex · Real-time energy data API · <a href="https://gridindex.io" style="color:#9ca3af;">gridindex.io</a></p>
    </div>`;

  try {
    const info = await transport.sendMail({ from: FROM, to: email, subject, html });
    logger.info('Welcome email sent', { to: email, messageId: info.messageId });
    return info;
  } catch (err) {
    // Never let a failed welcome email crash registration
    logger.error('Failed to send welcome email', { to: email, error: err.message });
    return null;
  }
}

/**
 * Send a price-threshold alert email.
 * @param {object} opts
 * @param {string} opts.email         — recipient
 * @param {string} opts.alertName     — user-defined label
 * @param {string} opts.region
 * @param {string} opts.alertType     — e.g. 'price_above', 'price_below', 'pct_change', 'carbon_above', 'renewable_below'
 * @param {number} opts.currentPrice
 * @param {number} opts.threshold
 * @param {number|null} opts.pctChange
 * @param {string} opts.triggeredAt   — ISO string
 */
async function sendAlertEmail({ email, alertName, region, alertType, currentPrice, threshold, pctChange, triggeredAt }) {
  const label = alertName || `${alertType} alert — ${region}`;
  const subject = `[GridIndex Alert] ${label}`;

  const typeLabel = {
    price_above:     'Price exceeded threshold',
    price_below:     'Price fell below threshold',
    pct_change:      'Price moved by percentage threshold',
    carbon_above:    'Carbon intensity exceeded threshold',
    renewable_below: 'Renewable generation fell below threshold'
  }[alertType] || alertType;

  // Format current value and threshold with the correct unit for the alert type
  const isCarbon    = alertType === 'carbon_above';
  const isRenewable = alertType === 'renewable_below';
  const isPct       = alertType === 'pct_change';

  function fmtCurrent(v) {
    if (v == null) return null;
    if (isCarbon)    return `${Number(v).toFixed(2)} g/kWh`;
    if (isRenewable) return `${Number(v).toFixed(1)}%`;
    return `$${Number(v).toFixed(2)}/MWh`;
  }
  function fmtThreshold(v) {
    if (v == null) return null;
    if (isCarbon)    return `${Number(v).toFixed(2)} g/kWh`;
    if (isRenewable) return `${Number(v).toFixed(1)}%`;
    if (isPct)       return `${Number(v).toFixed(2)}%`;
    return `$${Number(v).toFixed(2)}/MWh`;
  }

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
        <p style="margin:0;font-weight:600;color:#dc2626;">${typeLabel}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${new Date(triggeredAt).toUTCString()}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${priceRow('Region',    region)}
        ${priceRow('Alert',     label)}
        ${priceRow('Current',   fmtCurrent(currentPrice))}
        ${priceRow('Threshold', fmtThreshold(threshold))}
        ${priceRow('Change',    pctChange != null ? `${Number(pctChange).toFixed(2)}%` : null)}
      </table>

      <p style="font-size:13px;color:#6b7280;">
        Manage your alerts at <a href="https://app.gridindex.io/alerts" style="color:#1d4ed8;">app.gridindex.io/alerts</a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:12px;color:#9ca3af;">GridIndex · <a href="https://gridindex.io" style="color:#9ca3af;">gridindex.io</a></p>
    </div>`;

  try {
    const info = await transport.sendMail({ from: FROM, to: email, subject, html });
    logger.info('Alert email sent', { to: email, alertType, region, messageId: info.messageId });
    return info;
  } catch (err) {
    logger.error('Failed to send alert email', { to: email, error: err.message });
    throw err;   // caller (alertEngine) handles this and logs to alert_history
  }
}

/**
 * Verify SMTP connectivity on startup (no-op in test).
 */
async function verifyTransport() {
  try {
    await transport.verify();
    logger.info('SMTP transport verified');
  } catch (err) {
    logger.warn('SMTP transport verification failed — emails may not send', { error: err.message });
  }
}

module.exports = { sendWelcomeEmail, sendAlertEmail, verifyTransport };
