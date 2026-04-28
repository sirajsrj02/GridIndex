import api from './client';

export async function getUsage(days = 30) {
  const { data } = await api.get(`/dashboard/usage?days=${days}`);
  return data.data;
}

export async function getProfile() {
  const { data } = await api.get('/dashboard/profile');
  return data.data;
}
