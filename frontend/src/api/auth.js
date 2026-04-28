import api from './client';

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data.data; // { customer, token, api_key }
}

export async function register({ email, password, full_name, company_name }) {
  const { data } = await api.post('/auth/register', { email, password, full_name, company_name });
  return data.data;
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data.data;
}

export async function rotateApiKey() {
  const { data } = await api.post('/auth/rotate-key');
  return data.data; // { api_key, message }
}

export async function forgotPassword(email) {
  const { data } = await api.post('/auth/forgot-password', { email });
  return data.data; // { message }
}

export async function resetPassword(token, new_password) {
  const { data } = await api.post('/auth/reset-password', { token, new_password });
  return data.data; // { message }
}

export async function verifyEmail(token) {
  const { data } = await api.post('/auth/verify-email', { token });
  return data.data; // { message }
}

export async function resendVerification() {
  const { data } = await api.post('/auth/resend-verification');
  return data.data; // { message }
}

// Update editable profile fields (full_name, company_name, notification_prefs)
export async function updateProfile(patch) {
  const { data } = await api.patch('/auth/profile', patch);
  return data.data; // updated customer object
}
