// Helpers shared by the Setting pages.
import dayjs from 'dayjs';
import { errorMessage } from '../../api/client.js';

export { get } from '../../api/client.js';
export const date = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '');
export const money = (v) => (v || v === 0 ? Number(v).toLocaleString('en-IN') : '');
export const ymd = (d) => (d ? d.format('YYYY-MM-DD') : '');

/** The validation details of a 400, else the server message. */
export function problem(e) {
  const details = e.response?.data?.details;
  return details?.length ? details.map((x) => x.message).join('; ') : errorMessage(e);
}

/** Run a save and report it: resolves to the response data, or null after showing the error. */
export async function send(message, call) {
  try {
    const { data } = await call();
    if (data?.message) message.success(data.message);
    return data ?? {};
  } catch (e) {
    message.error(problem(e));
    return null;
  }
}
