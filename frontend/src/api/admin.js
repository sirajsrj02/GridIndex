import api from './client';

export async function getAdminStats() {
  const { data } = await api.get('/admin/stats');
  return data.data;
}

export async function getCustomers({ page = 1, limit = 25, q = '' } = {}) {
  const params = new URLSearchParams({ page, limit });
  if (q) params.set('q', q);
  const { data } = await api.get(`/admin/customers?${params}`);
  return data.data; // { customers, pagination }
}

export async function getCustomerDetail(id) {
  const { data } = await api.get(`/admin/customers/${id}`);
  return data.data; // { customer, recent_logs, alert_count }
}

export async function updateCustomer(id, patch) {
  const { data } = await api.patch(`/admin/customers/${id}`, patch);
  return data.data; // updated customer fields
}
