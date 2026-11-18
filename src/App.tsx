import { useEffect } from 'react';
import QuickStartStrip from './components/QuickStartStrip';
import TopBar from './components/TopBar';
import TabNav from './components/TabNav';
import SpineFilterBar from './components/SpineFilterBar';
import { useStore } from './store';
import Tab1Targets from './tabs/Tab1Targets';
import Tab2Bop from './tabs/Tab2Bop';
import Tab3Equipment from './tabs/Tab3Equipment';
import Tab4Lifts from './tabs/Tab4Lifts';
import Tab5Pfmea from './tabs/Tab5Pfmea';
import Tab6Labour from './tabs/Tab6Labour';
import Tab7Footprint from './tabs/Tab7Footprint';
import Tab8Utilisation from './tabs/Tab8Utilisation';
import Tab9Executive from './tabs/Tab9Executive';
import { APP_VERSION } from './types';

export const TABS: { n: number; label: string; short: string; group: 'input' | 'analysis' }[] = [
  { n: 1, label: 'Targets & Pre-Requisites', short: 'Targets', group: 'input' },
  { n: 2, label: 'Bill of Process', short: 'Bill of Process', group: 'input' },
  { n: 3, label: 'Equipment, Tooling, Vehicles & Stands', short: 'Equipment', group: 'input' },
  { n: 4, label: 'Component, Lift & Movement Analysis', short: 'Lift & Movement', group: 'input' },
  { n: 5, label: 'Cell & Process PFMEA', short: 'PFMEA', group: 'input' },
  { n: 6, label: 'Labour Load & Spatial Balancing', short: 'Labour & Spatial', group: 'input' },
  { n: 7, label: 'Footprint, Space & Dual-View Layout', short: 'Footprint & Layout', group: 'analysis' },
  { n: 8, label: 'Resource Utilisation & Concurrency', short: 'Utilisation', group: 'analysis' },
  { n: 9, label: 'Executive Summary', short: 'Executive Summary', group: 'analysis' },
];
export const OFFLINE_FILE_NAME = 'Assembly_Spine_v1.html';

/**
 * Purpose: Rebuild the pristine single-file app from the running page.
 *   The inlined <script> and <style> are kept verbatim, the React root is emptied,
 *   and anything portalled into <body> is dropped. Works from file:// where fetch() cannot.
 *
 * Downstream impact: drives the "Download Offline App (.html)" button in TopBar.
 *
 * @returns HTML string or null when this is a chunked/dev build
 */
export function offlineAppHtml(): string | null {
  if (document.querySelector('script[src]') || document.querySelector('link[rel="stylesheet"]')) return null;
  const doc = document.documentElement.cloneNode(true) as HTMLElement;
  const body = doc.querySelector('body');
  if (!body) return null;
  for (const el of [...body.children]) {
    if (el.id === 'root') el.innerHTML = '';
    else if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') el.remove();
  }
  return `<!doctype html>\n${doc.outerHTML}\n`;
}

export default function App() {
  const st = useStore();
  const { tab } = st;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [st]);
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <TopBar />
        <TabNav />
        <SpineFilterBar />
      </header>
      <main className="mx-auto max-w-[1680px] px-4 pb-16 pt-4">
        <QuickStartStrip />
        {tab === 1 && <Tab1Targets />}
        {tab === 2 && <Tab2Bop />}
        {tab === 3 && <Tab3Equipment />}
        {tab === 4 && <Tab4Lifts />}
        {tab === 5 && <Tab5Pfmea />}
        {tab === 6 && <Tab6Labour />}
        {tab === 7 && <Tab7Footprint />}
        {tab === 8 && <Tab8Utilisation />}
        {tab === 9 && <Tab9Executive />}
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-center text-[11px] text-slate-500">
        Assembly &amp; Static Build Central Spine v{APP_VERSION} · offline-first · no data leaves this device · en-GB
      </footer>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts } = useStore();
  const tone = { ok: 'border-slate-300 bg-white', warn: 'border-amber-300 bg-amber-50', error: 'border-red-300 bg-red-50' };
  return (
    <div className="no-print fixed bottom-4 right-4 z-[90] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`rounded-lg border px-3 py-2 text-[12.5px] text-slate-800 shadow-lg ${tone[t.kind]}`}>{t.text}</div>)}
    </div>
  );
}
