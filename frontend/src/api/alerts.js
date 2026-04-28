import api from './client';

export async function listAlerts() {
  const { data } = await api.get('/v1/alerts');
  return data.data;
}

export async function createAlert(body) {
  const { data } = await api.post('/v1/alerts', body);
  return data.data;
}

export async function updateAlert(id, body) {
  const { data } = await api.put(`/v1/alerts/${id}`, body);
  return data.data;
}

export async function deleteAlert(id) {
  const { data } = await api.delete(`/v1/alerts/${id}`);
  return data;
}

export async function getAlertHistory(id, limit = 20) {
  const { data } = await api.get(`/v1/alerts/${id}/history?limit=${limit}`);
  return data.data;
}

// All history across every alert for this customer
// Options: { region: 'CAISO', days: 30 }
export async function getAllAlertHistory(limit = 100, filters = {}) {
  const params = new URLSearchParams({ limit });
  if (filters.region) params.set('region', filters.region);
  if (filters.days)   params.set('days',   filters.days);
  const { data } = await api.get(`/v1/alerts/history?${params}`);
  return data.data;
}

// Fire a single test payload to a webhook alert's configured URL.
// Returns { delivered, statusCode, error, webhook_url }
export async function testWebhook(id) {
  const { data } = await api.post(`/v1/alerts/${id}/test`);
  return data;
}
