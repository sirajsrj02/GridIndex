'use strict';

const { logUsage } = require('../db/queries/usage');

/**
 * Records API call details to api_usage_logs after the response is sent.
 * Must be used after requireApiKey so req.customer is available.
 * Uses res.on('finish') to capture the final status code without delaying the response.
 */
function usageLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    if (!req.customer) return; // only log authenticated requests

    const responseTimeMs = Date.now() - start;
    const regionCode = req.query.region || req.params.region || null;

    logUsage({
      apiKey: req.apiKey,
      customerId: req.customer.id,
      endpoint: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
      method: req.method,
      regionCode,
      queryParams: Object.keys(req.query).length ? req.query : null,
      responseStatus: res.statusCode,
      responseTimeMs,
      responseRows: res.locals.responseRows || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
      errorMessage: res.locals.errorMessage || null
    }).catch(() => {}); // never let logging errors surface to the caller
  });

  next();
}

module.exports = { usageLogger };
