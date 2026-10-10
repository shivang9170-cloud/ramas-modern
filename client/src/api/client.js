// Axios instance with JWT handling. The token replaces the ASP.NET session cookie.
import axios from 'axios';

const TOKEN_KEY = 'ramas.token';

export const tokenStore = {
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(t) {
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((config) => {
  const t = tokenStore.get();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.endsWith('/auth/login')) onUnauthorized();
    // signed in with a default password: only the password change is allowed
    if (err.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED' && window.location.pathname !== '/password-change') {
      window.location.assign('/password-change');
    }
    return Promise.reject(err);
  },
);

/** GET that resolves to the response body. */
export const get = (url, params) => api.get(url, { params }).then((r) => r.data);

/** Human-readable message from an API error (server sends { error, details }). */
export function errorMessage(err) {
  const data = err?.response?.data;
  if (data?.details?.length) return `${data.error}: ${data.details.map((d) => d.message).join('; ')}`;
  return data?.error || err?.message || 'Something went wrong';
}
