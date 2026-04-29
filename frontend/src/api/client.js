import axios from 'axios';

// Dev: VITE_API_BASE_URL is unset → '/api' falls through to Vite's dev proxy
//      (proxy config in vite.config.js forwards /api → localhost:3000)
// Prod: VITE_API_BASE_URL = https://gridindex-api.up.railway.app
//       baseURL becomes https://gridindex-api.up.railway.app/api
const baseURL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gi_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token and redirect to login.
// Skip auth endpoints — a failed login/register legitimately returns 401
// and the form needs to receive the error, not get silently redirected.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
    if (err.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('gi_token');
      localStorage.removeItem('gi_customer');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
