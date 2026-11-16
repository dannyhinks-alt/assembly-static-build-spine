import type { Rag } from '../types';

const cache = new Map<number, Intl.NumberFormat>();
const nf = (d: number) => {
  let f = cache.get(d);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
    cache.set(d, f);
  }
  return f;
};

export const fmt = (n: number | null | undefined, d = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : nf(d).format(n);
export const fmtPct = (n: number | null | undefined, d = 1): string => (n == null || !Number.isFinite(n) ? '—' : `${nf(d).format(n)}%`);
export const fmtInt = (n: number | null | undefined): string => fmt(n, 0);
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
export const fmtGbp = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '—' : gbp.format(n));
export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const RAG_HEX: Record<Rag, string> = { green: '#0ca30c', amber: '#fab219', serious: '#ec835a', red: '#d03b3b' };
export const RAG_LABEL: Record<Rag, string> = { green: 'Green', amber: 'Amber', serious: 'Serious', red: 'Red' };
const ORDER: Rag[] = ['green', 'amber', 'serious', 'red'];
export const worstRag = (rags: Rag[]): Rag => rags.reduce<Rag>((w, r) => (ORDER.indexOf(r) > ORDER.indexOf(w) ? r : w), 'green');
export const ragRank = (r: Rag): number => ORDER.indexOf(r);

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
