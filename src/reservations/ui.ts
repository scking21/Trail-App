/* ui.ts — the Reservations view: list, upload flow, review-before-save, and the
 * manual-entry form. Vanilla DOM to match the rest of the app (no framework).
 * All styling hangs off `.res-*` classes injected once by ensureStyles(). */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { fileToParseInput } from './ingest';
import { runParser } from './parser/engine';
import { normalizeTime } from './parser/tz';
import { listAllReservations, saveReservation, deleteReservation } from './service';
import type {
  ParsedReservation, ReservationKind, Reservation, Segment,
} from './types';

const KIND_LABEL: Record<ReservationKind, string> = {
  flight: '✈️ Flight', hotel: '🏨 Hotel', car: '🚗 Car rental', train: '🚆 Train',
};

let root: HTMLElement | null = null;

export async function renderReservationsView(container: HTMLElement): Promise<void> {
  ensureStyles();
  root = container;
  container.classList.add('res-view');
  await refreshList();
}

async function refreshList(): Promise<void> {
  if (!root) return;
  const items = await listAllReservations().catch(() => [] as Reservation[]);
  root.innerHTML = '';
  root.appendChild(header());
  if (!items.length) {
    root.appendChild(el('p', 'res-empty', 'No reservations yet. Upload an e-ticket or add one manually.'));
  } else {
    const list = el('div', 'res-list');
    for (const r of items) list.appendChild(card(r));
    root.appendChild(list);
  }
  root.appendChild(el('p', 'res-privacy', '🔒 Documents are processed on your device and never uploaded.'));
}

function header(): HTMLElement {
  const bar = el('div', 'res-header');
  bar.appendChild(el('h2', 'res-title', 'Reservations'));
  const actions = el('div', 'res-actions');

  const upload = el('button', 'res-btn res-btn-primary', '⬆ Upload') as HTMLButtonElement;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/pdf,image/*,.eml,.ics,.html';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handleUpload(f);
    fileInput.value = '';
  });
  upload.addEventListener('click', () => fileInput.click());

  const manual = el('button', 'res-btn', '＋ Add manually') as HTMLButtonElement;
  manual.addEventListener('click', () => openEditor(blank('flight'), null));

  actions.append(upload, manual, fileInput);
  bar.appendChild(actions);
  return bar;
}

function card(r: Reservation): HTMLElement {
  const c = el('div', 'res-card');
  const seg = r.segments[0];
  const route = r.kind === 'hotel'
    ? (seg?.from.name || 'Hotel')
    : `${seg?.from.name || '?'} → ${seg?.to?.name || '?'}`;
  c.appendChild(el('div', 'res-card-kind', KIND_LABEL[r.kind]));
  c.appendChild(el('div', 'res-card-route', route));
  const when = seg?.from.timeLocal || seg?.from.timeUtc || '';
  c.appendChild(el('div', 'res-card-when', [r.provider, when].filter(Boolean).join(' · ')));
  if (r.confirmation) c.appendChild(el('div', 'res-card-conf', 'Conf: ' + r.confirmation));

  const del = el('button', 'res-link', 'Delete') as HTMLButtonElement;
  del.addEventListener('click', async () => {
    if (window.confirm('Delete this reservation?')) {
      await deleteReservation(r.id);
      await refreshList();
    }
  });
  c.appendChild(del);
  return c;
}

// --- upload + review --------------------------------------------------------

async function handleUpload(file: File): Promise<void> {
  const overlay = busy('Reading ' + file.name + ' …');
  try {
    const input = await fileToParseInput(file);
    const result = runParser(input);
    overlay.remove();
    openEditor(result.reservation, file, {
      confidence: result.confidence,
      fieldConfidence: result.fieldConfidence,
      passedGate: result.passedGate,
      strategy: result.strategy,
    });
  } catch (e) {
    overlay.remove();
    alert('Could not read that file. You can still add it manually.');
    openEditor(blank('flight'), file);
  }
}

interface ReviewMeta {
  confidence: number;
  fieldConfidence?: Record<string, number>;
  passedGate: boolean;
  strategy: string;
}

function openEditor(draft: ParsedReservation, file: File | null, meta?: ReviewMeta): void {
  const modal = el('div', 'res-modal');
  const sheet = el('div', 'res-sheet');
  modal.appendChild(sheet);

  const title = meta ? 'Review & save' : 'Add reservation';
  sheet.appendChild(el('h3', 'res-sheet-title', title));
  if (meta && !meta.passedGate) {
    sheet.appendChild(el('div', 'res-warn',
      'We couldn’t read this confidently — please check the fields below.'));
  }

  const state: ParsedReservation = JSON.parse(JSON.stringify(draft));
  if (!state.segments.length) state.segments = [blankSegment()];

  const form = el('div', 'res-form');
  const kindRow = field('Type');
  const kindSel = document.createElement('select');
  (['flight', 'hotel', 'car', 'train'] as ReservationKind[]).forEach((k) => {
    const o = document.createElement('option');
    o.value = k; o.textContent = KIND_LABEL[k];
    if (k === state.kind) o.selected = true;
    kindSel.appendChild(o);
  });
  kindSel.addEventListener('change', () => { state.kind = kindSel.value as ReservationKind; });
  kindRow.appendChild(kindSel);
  form.appendChild(kindRow);

  const s = state.segments[0];
  form.appendChild(textField('Provider', state.provider, (v) => state.provider = v, weak(meta, 'airline') || weak(meta, 'operator') || weak(meta, 'agency') || weak(meta, 'name')));
  form.appendChild(textField('Confirmation #', state.confirmation, (v) => state.confirmation = v));
  form.appendChild(textField(fromLabel(state.kind), s.from.name, (v) => s.from.name = v, weak(meta, 'from')));
  form.appendChild(textField(fromTimeLabel(state.kind), s.from.timeLocal ?? '', (v) => s.from.timeLocal = v, weak(meta, 'dep') || weak(meta, 'checkIn') || weak(meta, 'pick')));
  form.appendChild(textField(toLabel(state.kind), s.to?.name ?? '', (v) => setTo(s, 'name', v), weak(meta, 'to')));
  form.appendChild(textField(toTimeLabel(state.kind), s.to?.timeLocal ?? '', (v) => setTo(s, 'timeLocal', v)));
  form.appendChild(textField('Notes', state.notes ?? '', (v) => state.notes = v));
  sheet.appendChild(form);

  const buttons = el('div', 'res-sheet-actions');
  const cancel = el('button', 'res-btn', 'Cancel') as HTMLButtonElement;
  cancel.addEventListener('click', () => modal.remove());
  const save = el('button', 'res-btn res-btn-primary', 'Save') as HTMLButtonElement;
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      if (file) {
        const att = await saveAttachment(file).catch(() => null);
        if (att) state.attachments = [att];
      }
      // Re-derive UTC from any edited local times before persisting.
      reNormalize(state);
      await saveReservation({ ...state, source: file ? 'upload' : 'manual' });
      modal.remove();
      await refreshList();
    } catch (e) {
      save.disabled = false;
      alert('Could not save: ' + (e as Error).message);
    }
  });
  buttons.append(cancel, save);
  sheet.appendChild(buttons);

  (root || document.body).appendChild(modal);
}

function setTo(s: Segment, key: 'name' | 'timeLocal', v: string): void {
  if (!s.to) s.to = { name: null };
  (s.to as any)[key] = v;
}

function reNormalize(state: ParsedReservation): void {
  for (const seg of state.segments) {
    if (seg.from.timeLocal) Object.assign(seg.from, normalizeTime(seg.from.timeLocal, seg.from.name));
    if (seg.to?.timeLocal) Object.assign(seg.to, normalizeTime(seg.to.timeLocal, seg.to.name));
  }
}

// --- attachment storage -----------------------------------------------------

async function saveAttachment(file: File): Promise<{ filePath: string; mime: string; filename: string }> {
  const b64 = await fileToBase64(file);
  const path = `reservations/${Date.now()}_${sanitize(file.name)}`;
  await Filesystem.writeFile({
    path, data: b64, directory: Directory.Data, recursive: true,
  });
  return { filePath: path, mime: file.type || 'application/octet-stream', filename: file.name };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// --- small helpers ----------------------------------------------------------

function fromLabel(k: ReservationKind): string {
  return ({ flight: 'From (airport)', hotel: 'Property', car: 'Pick-up location', train: 'From (station)' })[k];
}
function toLabel(k: ReservationKind): string {
  return ({ flight: 'To (airport)', hotel: 'Address', car: 'Drop-off location', train: 'To (station)' })[k];
}
function fromTimeLabel(k: ReservationKind): string {
  return ({ flight: 'Departs (local)', hotel: 'Check-in', car: 'Pick-up time', train: 'Departs (local)' })[k];
}
function toTimeLabel(k: ReservationKind): string {
  return ({ flight: 'Arrives (local)', hotel: 'Check-out', car: 'Drop-off time', train: 'Arrives (local)' })[k];
}

function weak(meta: ReviewMeta | undefined, key: string): boolean {
  if (!meta?.fieldConfidence) return false;
  const v = meta.fieldConfidence[key];
  return v != null && v < 0.5;
}

function blank(kind: ReservationKind): ParsedReservation {
  return {
    kind, tripId: null, provider: null, confirmation: null, status: 'confirmed',
    cost: null, notes: null, source: 'manual', parseConfidence: null,
    attachments: [], segments: [blankSegment()],
  };
}
function blankSegment(): Segment {
  return { seq: 0, from: { name: null, timeLocal: '' }, to: { name: null, timeLocal: '' }, extra: {} };
}

function field(label: string): HTMLElement {
  const wrap = el('label', 'res-field');
  wrap.appendChild(el('span', 'res-field-label', label));
  return wrap;
}
function textField(label: string, value: string | null | undefined, onChange: (v: string) => void, flag = false): HTMLElement {
  const wrap = field(label);
  if (flag) wrap.classList.add('res-field-weak');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value ?? '';
  input.addEventListener('input', () => onChange(input.value));
  wrap.appendChild(input);
  return wrap;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function busy(msg: string): HTMLElement {
  const o = el('div', 'res-modal');
  const box = el('div', 'res-busy', msg);
  o.appendChild(box);
  (root || document.body).appendChild(o);
  return o;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

let stylesInjected = false;
function ensureStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  .res-view{padding:12px;max-width:680px;margin:0 auto}
  .res-header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
  .res-title{margin:0;font-size:20px}
  .res-actions{display:flex;gap:8px}
  .res-btn{padding:8px 12px;border-radius:10px;border:1px solid #2d4a33;background:#fff;font-size:14px;cursor:pointer}
  .res-btn-primary{background:#1f3a24;color:#fff;border-color:#1f3a24}
  .res-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}
  .res-card{border:1px solid #e0e0e0;border-radius:12px;padding:12px;position:relative}
  .res-card-kind{font-size:12px;color:#567}
  .res-card-route{font-weight:600;font-size:16px;margin:2px 0}
  .res-card-when{color:#445;font-size:13px}
  .res-card-conf{color:#778;font-size:12px;margin-top:4px}
  .res-link{position:absolute;top:10px;right:10px;background:none;border:none;color:#a33;cursor:pointer;font-size:12px}
  .res-empty{color:#778;margin-top:16px}
  .res-privacy{color:#7a8;font-size:12px;margin-top:16px;text-align:center}
  .res-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center;z-index:9999}
  .res-sheet{background:#fff;border-radius:16px 16px 0 0;padding:16px;width:100%;max-width:680px;max-height:88vh;overflow:auto;padding-bottom:max(16px,env(safe-area-inset-bottom))}
  .res-sheet-title{margin:0 0 12px}
  .res-warn{background:#fff3cd;border:1px solid #ffe69c;color:#664d03;padding:8px 10px;border-radius:8px;font-size:13px;margin-bottom:10px}
  .res-form{display:flex;flex-direction:column;gap:10px}
  .res-field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#445}
  .res-field input,.res-field select{padding:9px 10px;border:1px solid #ccd;border-radius:8px;font-size:15px}
  .res-field-weak input{border-color:#e0a800;background:#fffdf5}
  .res-sheet-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
  .res-busy{background:#fff;border-radius:12px;padding:18px 22px;margin:auto;font-size:14px}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  void Capacitor; // platform-aware tweaks can hook here later
}
