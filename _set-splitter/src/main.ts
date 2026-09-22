import "./style.css";
import {
  segmentSongs,
  type AnalyzeOptions,
  type WindowFeature,
} from "./analyze";
import { audioBufferSliceToWav } from "./wav";
import { audioBufferSliceToMp3 } from "./mp3";
import { Player } from "./player";
import { extractRecordingDate, formatMMDDYYYY } from "./metadata";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
};

const dropEl = $<HTMLDivElement>("#drop");
const fileInput = $<HTMLInputElement>("#file");
const pickBtn = $<HTMLButtonElement>("#pick");
const statusEl = $<HTMLElement>("#status");
const controlsEl = $<HTMLElement>("#controls");
const vizEl = $<HTMLElement>("#viz");
const canvas = $<HTMLCanvasElement>("#canvas");
const axisEl = $<HTMLElement>("#axis");
const songsEl = $<HTMLElement>("#songs");
const minSongInput = $<HTMLInputElement>("#minSong");
const minSongVal = $<HTMLElement>("#minSongVal");
const minGapInput = $<HTMLInputElement>("#minGap");
const minGapVal = $<HTMLElement>("#minGapVal");
const sensInput = $<HTMLInputElement>("#sens");
const sensVal = $<HTMLElement>("#sensVal");
const reanalyzeBtn = $<HTMLButtonElement>("#reanalyze");
const downloadAllBtn = $<HTMLButtonElement>("#downloadAll");
const formatSelect = $<HTMLSelectElement>("#format");
const artistInput = $<HTMLInputElement>("#artist");
const dateInput = $<HTMLInputElement>("#date");

interface Song {
  id: string;
  start: number;
  end: number;
  name: string;
  customName: boolean; // true = user edited it; false = auto-generated from artist/date
  selected: boolean;   // for the merge action
}

interface State {
  audioBuffer: AudioBuffer | null;
  fileName: string;
  features: WindowFeature[];
  windowSec: number;
  duration: number;
  songs: Song[];
}

const state: State = {
  audioBuffer: null,
  fileName: "",
  features: [],
  windowSec: 0.5,
  duration: 0,
  songs: [],
};

artistInput.addEventListener("input", () => {
  refreshAutoNames();
  renderSongs();
});
dateInput.addEventListener("input", () => {
  refreshAutoNames();
  renderSongs();
});

function autoName(index: number): string {
  const n = pad2(index + 1);
  const artist = artistInput.value.trim();
  const date = dateInput.value.trim();
  const parts = [`Audio ${n}`];
  if (artist) parts.push(artist);
  if (date) parts.push(date);
  return parts.join(" - ");
}

function refreshAutoNames() {
  state.songs.forEach((s, i) => {
    if (!s.customName) s.name = autoName(i);
  });
}

const player = new Player();
let playheadRafHandle = 0;
// player.onChange is assigned after renderSongs is defined, so it can also
// pause the per-row preview elements when the whole-file player starts.

// A pending drag-selection preview and edge-resize state — mouse handlers own
// this; drawViz() reads it to render feedback.
type Interaction =
  | null
  | { kind: "resize"; songId: string; edge: "start" | "end"; startX: number; moved: boolean }
  | { kind: "create"; startT: number; startX: number; currentT: number; moved: boolean }
  | { kind: "click"; startX: number; startT: number };
let interaction: Interaction = null;

// --- File input plumbing ---

function setStatus(text: string, kind: "info" | "error" = "info") {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", kind === "error");
  statusEl.classList.remove("hidden");
}

function clearStatus() {
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
}

pickBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropEl.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void handleFile(f);
});

["dragenter", "dragover"].forEach((ev) =>
  dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    dropEl.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    dropEl.classList.remove("dragover");
  }),
);
dropEl.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) void handleFile(f);
});

// --- Controls ---

function getOptions(): AnalyzeOptions {
  return {
    minSongSec: parseInt(minSongInput.value, 10),
    minGapSec: parseInt(minGapInput.value, 10),
    sensitivity: parseInt(sensInput.value, 10),
  };
}

function updateControlLabels() {
  minSongVal.textContent = `${minSongInput.value}s`;
  minGapVal.textContent = `${minGapInput.value}s`;
  sensVal.textContent = sensInput.value;
}

[minSongInput, minGapInput, sensInput].forEach((inp) => {
  inp.addEventListener("input", updateControlLabels);
});
updateControlLabels();

reanalyzeBtn.addEventListener("click", () => {
  if (!state.features.length) return;
  rebuildSongsFromAnalysis();
});

downloadAllBtn.addEventListener("click", () => void downloadAll());

// Spacebar toggles play/pause when the strip is in view — but not while
// typing in a song name field.
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (!state.audioBuffer) return;
  e.preventDefault();
  player.toggle();
});

// --- Pipeline ---

async function handleFile(file: File) {
  state.fileName = file.name.replace(/\.[^.]+$/, "");
  setStatus(`Decoding ${file.name}…`);
  controlsEl.classList.add("hidden");
  vizEl.classList.add("hidden");
  songsEl.innerHTML = "";
  player.stop();

  // Pull the recording date from file metadata (ID3 / BWF / M4A). Falls back
  // to file.lastModified — that's what a phone or field recorder writes as
  // the modified timestamp when saving the recording. Overwrites whatever
  // was in the field: a new file is a new session, and the user can retype
  // if they need to override.
  let date: Date | null = null;
  try { date = await extractRecordingDate(file); } catch { /* ignore */ }
  if (!date && file.lastModified) date = new Date(file.lastModified);
  if (date) dateInput.value = formatMMDDYYYY(date);

  try {
    const arrayBuf = await file.arrayBuffer();
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuf = await ac.decodeAudioData(arrayBuf.slice(0));
    void ac.close();
    state.audioBuffer = audioBuf;
    state.duration = audioBuf.duration;
    player.setBuffer(audioBuf);

    setStatus(
      `Analyzing ${formatDuration(audioBuf.duration)} of audio (${audioBuf.numberOfChannels}ch @ ${audioBuf.sampleRate} Hz)…`,
    );
    await runAnalysis();
  } catch (err) {
    console.error(err);
    setStatus(
      `Couldn't process file: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

function runAnalysis(): Promise<void> {
  if (!state.audioBuffer) return Promise.resolve();
  const buffer = state.audioBuffer;
  const channels: Float32Array[] = [];
  const transfers: ArrayBuffer[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const copy = new Float32Array(buffer.getChannelData(c));
    channels.push(copy);
    transfers.push(copy.buffer);
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (ev: MessageEvent<any>) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        setStatus(`Analyzing… ${Math.round(msg.progress * 100)}%`);
      } else if (msg.type === "done") {
        worker.terminate();
        state.features = msg.features;
        state.windowSec = msg.windowSec;
        state.duration = msg.duration;
        clearStatus();
        controlsEl.classList.remove("hidden");
        vizEl.classList.remove("hidden");
        requestAnimationFrame(() => {
          rebuildSongsFromAnalysis();
          resolve();
        });
      } else if (msg.type === "error") {
        worker.terminate();
        setStatus(`Analysis error: ${msg.error}`, "error");
        reject(new Error(msg.error));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      setStatus(`Worker error: ${err.message}`, "error");
      reject(err);
    };
    worker.postMessage(
      {
        type: "analyze",
        channels,
        sampleRate: buffer.sampleRate,
        length: buffer.length,
        numberOfChannels: buffer.numberOfChannels,
        duration: buffer.duration,
      },
      transfers,
    );
  });
}

function rebuildSongsFromAnalysis() {
  const opts = getOptions();
  const segments = segmentSongs(state.features, state.windowSec, state.duration, opts);
  state.songs = segments.map((s) => ({
    id: nextId(),
    start: s.start,
    end: s.end,
    name: "",
    customName: false,
    selected: false,
  }));
  sortSongs();
  refreshAutoNames();
  resetView();
  drawViz();
  renderSongs();
}

function sortSongs() {
  state.songs.sort((a, b) => a.start - b.start);
}

// --- Visualization ---

let cssWidth = 0;
let cssHeight = 180;

// The strip viewport: the [viewStart, viewEnd] slice of the full recording
// that's drawn across the whole canvas. Zoom in → shrink this range around
// the cursor; scroll → shift both ends by the same amount.
let viewStart = 0;
let viewEnd = 0;
const MIN_VIEW_SEC = 2; // don't zoom in past 2 s wide

function resetView() {
  viewStart = 0;
  viewEnd = state.duration || 0;
}

function setView(start: number, end: number) {
  const dur = state.duration || 0;
  let s = start, e = end;
  if (e - s < MIN_VIEW_SEC) e = s + MIN_VIEW_SEC;
  if (e - s > dur) { s = 0; e = dur; }
  if (s < 0) { e -= s; s = 0; }
  if (e > dur) { s -= e - dur; e = dur; }
  viewStart = Math.max(0, s);
  viewEnd = Math.min(dur, e);
}

function zoomAround(anchorSec: number, factor: number) {
  const newRange = Math.max(MIN_VIEW_SEC, (viewEnd - viewStart) * factor);
  const anchorFrac = (anchorSec - viewStart) / Math.max(0.001, viewEnd - viewStart);
  const newStart = anchorSec - anchorFrac * newRange;
  setView(newStart, newStart + newRange);
}

function drawViz() {
  const dpr = window.devicePixelRatio || 1;
  cssWidth = canvas.clientWidth || canvas.parentElement!.clientWidth - 24;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Snap view to full duration when nothing else set it.
  if (viewEnd <= viewStart) resetView();
  const range = Math.max(0.001, viewEnd - viewStart);

  // Background label heatmap — only features that touch the visible range.
  const viewBinW = Math.max(1, (state.windowSec / range) * cssWidth);
  for (const f of state.features) {
    if (f.t + state.windowSec < viewStart) continue;
    if (f.t > viewEnd) break;
    const x = timeToX(f.t);
    ctx.fillStyle = labelColor(f.label);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, 0, viewBinW, cssHeight);
  }
  ctx.globalAlpha = 1;

  // Music-score line, clipped to the view.
  ctx.strokeStyle = "#e8ecf1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < state.features.length; i++) {
    const f = state.features[i];
    if (f.t < viewStart - state.windowSec) continue;
    if (f.t > viewEnd + state.windowSec) break;
    const x = timeToX(f.t);
    const y = cssHeight - f.musicScore * cssHeight;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Selection tint for merge selections — drawn under song outlines.
  state.songs.forEach((s) => {
    if (!s.selected) return;
    if (s.end < viewStart || s.start > viewEnd) return;
    const x1 = timeToX(s.start);
    const x2 = timeToX(s.end);
    ctx.fillStyle = "rgba(124,196,255,0.28)";
    ctx.fillRect(x1, 2, x2 - x1, cssHeight - 4);
  });

  // Song rectangles, with edge handles.
  state.songs.forEach((s, i) => {
    if (s.end < viewStart || s.start > viewEnd) return;
    const x1 = timeToX(s.start);
    const x2 = timeToX(s.end);
    ctx.strokeStyle = s.selected ? "#7cc4ff" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x1 + 1, 2, x2 - x1 - 2, cssHeight - 4);
    // Edge handles only if they fall within the visible range.
    ctx.fillStyle = ctx.strokeStyle;
    if (x1 >= 0 && x1 <= cssWidth) ctx.fillRect(x1, 2, 3, cssHeight - 4);
    if (x2 >= 0 && x2 <= cssWidth) ctx.fillRect(x2 - 3, 2, 3, cssHeight - 4);
    ctx.font = "bold 12px system-ui";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(i + 1), Math.max(x1 + 6, 4), 15);
  });

  // Pending create-selection preview.
  if (interaction?.kind === "create" && interaction.moved) {
    const a = Math.min(interaction.startT, interaction.currentT);
    const b = Math.max(interaction.startT, interaction.currentT);
    const xa = timeToX(a);
    const xb = timeToX(b);
    ctx.fillStyle = "rgba(124,196,255,0.25)";
    ctx.fillRect(xa, 2, xb - xa, cssHeight - 4);
    ctx.strokeStyle = "#7cc4ff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(xa + 0.5, 2.5, xb - xa - 1, cssHeight - 5);
    ctx.setLineDash([]);
  }

  // Playhead — only if it's in the visible range.
  if (state.audioBuffer) {
    const t = player.currentTime;
    if (t >= viewStart && t <= viewEnd) {
      const x = timeToX(t);
      ctx.strokeStyle = "#ffb454";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, cssHeight);
      ctx.stroke();
      ctx.fillStyle = "#ffb454";
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Legend row + axis (regenerated so it can show zoom level).
  vizEl.querySelector(".legend")?.remove();
  const zoomFactor = state.duration > 0 ? state.duration / range : 1;
  const zoomLabel = zoomFactor > 1.05 ? ` · zoom ${zoomFactor.toFixed(1)}×` : "";
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `
    <span class="l-music">music</span>
    <span class="l-applause">applause</span>
    <span class="l-talk">talk / other</span>
    <span class="l-silence">silence</span>
    <span>· ${state.songs.length} song${state.songs.length === 1 ? "" : "s"}${zoomLabel}</span>
    <span class="hint">· click to seek · drag empty space to create · drag edges to crop · scroll to pan · ⌘/ctrl-scroll to zoom</span>`;
  vizEl.appendChild(legend);

  axisEl.innerHTML = "";
  const markers = 6;
  for (let i = 0; i <= markers; i++) {
    const t = viewStart + (range * i) / markers;
    const span = document.createElement("span");
    span.textContent = formatDuration(t);
    axisEl.appendChild(span);
  }

  drawScrollbar();
}

// Minimap-style scrollbar under the canvas: full duration in a thin strip
// with a highlight over the visible viewport. Click to jump; drag to pan.
function drawScrollbar() {
  let bar = vizEl.querySelector<HTMLDivElement>(".scrollbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "scrollbar";
    bar.innerHTML = '<div class="thumb"></div>';
    vizEl.appendChild(bar);
    bar.addEventListener("mousedown", (e) => startScrollDrag(e, bar!));
  }
  const thumb = bar.querySelector<HTMLDivElement>(".thumb")!;
  const dur = state.duration || 1;
  const startPct = (viewStart / dur) * 100;
  const widthPct = ((viewEnd - viewStart) / dur) * 100;
  thumb.style.left = `${startPct}%`;
  thumb.style.width = `${Math.max(2, widthPct)}%`;
  // Hide it if we're at full zoom-out.
  bar.style.display = widthPct >= 99.5 ? "none" : "";
}

function startScrollDrag(ev: MouseEvent, bar: HTMLDivElement) {
  const dur = state.duration || 0;
  if (dur <= 0) return;
  const rect = bar.getBoundingClientRect();
  const viewLen = viewEnd - viewStart;
  const centerFromClientX = (clientX: number) => {
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    setView(frac * dur - viewLen / 2, frac * dur + viewLen / 2);
    drawViz();
  };
  centerFromClientX(ev.clientX);
  const onMove = (e: MouseEvent) => centerFromClientX(e.clientX);
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function labelColor(label: WindowFeature["label"]): string {
  switch (label) {
    case "music": return "#2f6bb8";
    case "applause": return "#8a5b26";
    case "talk": return "#5f4a86";
    case "silence": return "#20242e";
  }
}

// --- Canvas interactions ---

const EDGE_HIT_PX = 8;
const DRAG_THRESHOLD_PX = 4;

function xToTime(x: number): number {
  if (cssWidth <= 0 || state.duration <= 0) return 0;
  const range = Math.max(0.001, viewEnd - viewStart);
  return clamp(viewStart + (x / cssWidth) * range, 0, state.duration);
}

function timeToX(t: number): number {
  const range = Math.max(0.001, viewEnd - viewStart);
  return ((t - viewStart) / range) * cssWidth;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

interface HitInfo {
  kind: "empty" | "inside" | "edge";
  songId?: string;
  edge?: "start" | "end";
}

function hitTest(x: number): HitInfo {
  const t = xToTime(x);
  // Edge check first — handles win over inside so start/end are draggable
  // even inside a very short region.
  for (const s of state.songs) {
    const x1 = timeToX(s.start);
    const x2 = timeToX(s.end);
    if (Math.abs(x - x1) <= EDGE_HIT_PX) return { kind: "edge", songId: s.id, edge: "start" };
    if (Math.abs(x - x2) <= EDGE_HIT_PX) return { kind: "edge", songId: s.id, edge: "end" };
  }
  for (const s of state.songs) {
    if (t >= s.start && t <= s.end) return { kind: "inside", songId: s.id };
  }
  return { kind: "empty" };
}

function cursorFor(hit: HitInfo): string {
  if (hit.kind === "edge") return "ew-resize";
  if (hit.kind === "inside") return "pointer";
  return "crosshair";
}

function canvasX(e: MouseEvent): number {
  const rect = canvas.getBoundingClientRect();
  return clamp(e.clientX - rect.left, 0, rect.width);
}

canvas.addEventListener("mousemove", (e) => {
  if (!state.audioBuffer) return;
  const x = canvasX(e);

  if (interaction) {
    const t = xToTime(x);
    if (Math.abs(x - interaction.startX) > DRAG_THRESHOLD_PX) {
      if (interaction.kind === "click") {
        // Promote a click that started outside any song into a "create" drag;
        // one that started inside a song does nothing (avoids overlapping).
        const hit = hitTest(interaction.startX);
        if (hit.kind === "empty") {
          interaction = { kind: "create", startT: interaction.startT, startX: interaction.startX, currentT: t, moved: true };
        } else {
          interaction = { kind: "click", startX: interaction.startX, startT: interaction.startT };
          (interaction as any).moved = true; // consume — no click-fire on mouseup
        }
      } else if (interaction.kind === "create") {
        interaction.currentT = t;
        interaction.moved = true;
      } else if (interaction.kind === "resize") {
        const iv = interaction;
        const song = state.songs.find((s) => s.id === iv.songId);
        if (song) {
          if (iv.edge === "start") {
            song.start = clamp(t, 0, song.end - 0.5);
          } else {
            song.end = clamp(t, song.start + 0.5, state.duration);
          }
          iv.moved = true;
        }
      }
      drawViz();
    }
  } else {
    canvas.style.cursor = cursorFor(hitTest(x));
  }
});

// Mouse wheel: plain scroll pans horizontally within the current zoom;
// ⌘/ctrl + scroll zooms around the cursor.
canvas.addEventListener("wheel", (e) => {
  if (!state.audioBuffer) return;
  e.preventDefault();
  const anchor = xToTime(canvasX(e));
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(e.deltaY * 0.002); // deltaY > 0 → zoom out
    zoomAround(anchor, factor);
  } else {
    const range = viewEnd - viewStart;
    // Trackpads report deltaX for horizontal swipes; mice usually only deltaY.
    const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    const shift = (dx / cssWidth) * range;
    setView(viewStart + shift, viewEnd + shift);
  }
  drawViz();
}, { passive: false });

canvas.addEventListener("mousedown", (e) => {
  if (!state.audioBuffer) return;
  const x = canvasX(e);
  const hit = hitTest(x);
  if (hit.kind === "edge" && hit.songId && hit.edge) {
    interaction = { kind: "resize", songId: hit.songId, edge: hit.edge, startX: x, moved: false };
  } else {
    interaction = { kind: "click", startX: x, startT: xToTime(x) };
  }
});

window.addEventListener("mouseup", (e) => {
  if (!interaction) return;
  const x = canvasX(e);

  if (interaction.kind === "click") {
    // Click without meaningful drag → seek + play.
    const t = xToTime(x);
    player.play(t);
  } else if (interaction.kind === "create" && interaction.moved) {
    const a = Math.min(interaction.startT, interaction.currentT);
    const b = Math.max(interaction.startT, interaction.currentT);
    if (b - a >= 1) {
      state.songs.push({
        id: nextId(),
        start: a,
        end: b,
        name: "",
        customName: false,
        selected: false,
      });
      sortSongs();
      refreshAutoNames();
      renderSongs();
    }
  } else if (interaction.kind === "resize" && interaction.moved) {
    sortSongs();
    refreshAutoNames();
    renderSongs();
  }
  interaction = null;
  drawViz();
});

// --- Playhead animation ---

function startPlayheadLoop() {
  if (playheadRafHandle) return;
  const tick = () => {
    drawViz();
    playheadRafHandle = requestAnimationFrame(tick);
  };
  playheadRafHandle = requestAnimationFrame(tick);
}
function stopPlayheadLoop() {
  if (playheadRafHandle) {
    cancelAnimationFrame(playheadRafHandle);
    playheadRafHandle = 0;
  }
}

// --- Songs list + downloads ---

const activePreviewUrls: string[] = [];

function renderSongs() {
  for (const url of activePreviewUrls) URL.revokeObjectURL(url);
  activePreviewUrls.length = 0;

  songsEl.innerHTML = "";
  if (state.songs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent =
      "No songs yet. Drag on empty space in the strip above to create one, or lower the minimum song length and re-analyze.";
    songsEl.appendChild(empty);
    downloadAllBtn.disabled = true;
    return;
  }
  downloadAllBtn.disabled = false;

  // Toolbar for merge action, only shown when 2+ rows are selected.
  const selectedCount = state.songs.filter((s) => s.selected).length;
  if (selectedCount >= 2) {
    const bar = document.createElement("div");
    bar.className = "merge-bar";
    bar.innerHTML = `
      <span>${selectedCount} songs selected</span>
      <button data-act="merge" class="primary">Merge into one</button>
      <button data-act="clear-sel">Clear selection</button>
    `;
    bar.querySelector<HTMLButtonElement>("[data-act=merge]")!.addEventListener(
      "click",
      () => mergeSelectedSongs(),
    );
    bar.querySelector<HTMLButtonElement>("[data-act=clear-sel]")!.addEventListener(
      "click",
      () => {
        for (const s of state.songs) s.selected = false;
        renderSongs();
        drawViz();
      },
    );
    songsEl.appendChild(bar);
  }

  state.songs.forEach((song, i) => {
    const row = document.createElement("div");
    row.className = "song" + (song.selected ? " selected" : "");
    row.dataset.id = song.id;
    row.innerHTML = `
      <label class="select"><input type="checkbox" ${song.selected ? "checked" : ""} title="Select for merge" /></label>
      <div class="num">${pad2(i + 1)}</div>
      <div class="meta">
        <div class="name-row">
          <input class="name-input" type="text" value="${escapeHtml(song.name)}" />
        </div>
        <div class="times"><span class="t-start">${formatDuration(song.start)}</span> – <span class="t-end">${formatDuration(song.end)}</span> (${formatDuration(song.end - song.start)})</div>
      </div>
      <div class="actions">
        <button data-act="delete" title="Delete this song">✕</button>
        <button data-act="download" class="primary">Download</button>
      </div>
    `;
    const nameInput = row.querySelector<HTMLInputElement>(".name-input")!;
    nameInput.addEventListener("input", () => {
      song.name = nameInput.value;
      song.customName = true;
    });
    const selectBox = row.querySelector<HTMLInputElement>(".select input")!;
    selectBox.addEventListener("change", () => {
      song.selected = selectBox.checked;
      renderSongs();
      drawViz();
    });

    row.querySelector<HTMLButtonElement>("[data-act=delete]")!.addEventListener(
      "click",
      () => deleteSong(song.id),
    );
    row.querySelector<HTMLButtonElement>("[data-act=download]")!.addEventListener(
      "click",
      (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        void downloadSong(song, btn);
      },
    );

    if (state.audioBuffer) {
      const blob = audioBufferSliceToWav(state.audioBuffer, song.start, song.end);
      const url = URL.createObjectURL(blob);
      activePreviewUrls.push(url);
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = url;
      // Only one playback surface at a time: when this one starts, stop the
      // whole-file player and every other per-song player.
      audio.addEventListener("play", () => {
        if (player.isPlaying) player.pause();
        document.querySelectorAll<HTMLAudioElement>(".song audio").forEach((other) => {
          if (other !== audio && !other.paused) other.pause();
        });
      });
      row.appendChild(audio);
    }

    songsEl.appendChild(row);
  });
}

// When the whole-file player starts, pause every song-row preview so we
// never have two things playing at once.
player.onChange = () => {
  if (player.isPlaying) {
    startPlayheadLoop();
    document.querySelectorAll<HTMLAudioElement>(".song audio").forEach((a) => {
      if (!a.paused) a.pause();
    });
  } else {
    stopPlayheadLoop();
  }
  drawViz();
};

function deleteSong(id: string) {
  state.songs = state.songs.filter((s) => s.id !== id);
  sortSongs();
  refreshAutoNames();
  renderSongs();
  drawViz();
}

async function downloadSong(song: Song, btn?: HTMLButtonElement) {
  if (!state.audioBuffer) return;
  const fmt = formatSelect.value;
  if (btn) { btn.disabled = true; btn.textContent = "Encoding…"; }
  await new Promise((r) => setTimeout(r, 0));
  try {
    let blob: Blob;
    let ext: string;
    if (fmt === "wav") {
      blob = audioBufferSliceToWav(state.audioBuffer, song.start, song.end);
      ext = "wav";
    } else {
      const kbps = parseInt(fmt.split("-")[1], 10) || 192;
      blob = audioBufferSliceToMp3(state.audioBuffer, song.start, song.end, kbps);
      ext = "mp3";
    }
    triggerDownload(blob, `${sanitize(song.name)}.${ext}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Download"; }
  }
}

async function downloadAll() {
  if (!state.audioBuffer) return;
  downloadAllBtn.disabled = true;
  const original = downloadAllBtn.textContent;
  for (let i = 0; i < state.songs.length; i++) {
    downloadAllBtn.textContent = `Encoding ${i + 1}/${state.songs.length}…`;
    await new Promise((r) => setTimeout(r, 0));
    await downloadSong(state.songs[i]);
    await new Promise((r) => setTimeout(r, 250));
  }
  downloadAllBtn.textContent = original;
  downloadAllBtn.disabled = false;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Utils ---

let idCounter = 0;
function nextId(): string {
  return `s${++idCounter}`;
}

function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "song";
}

function mergeSelectedSongs() {
  const picked = state.songs.filter((s) => s.selected);
  if (picked.length < 2) return;
  const start = Math.min(...picked.map((s) => s.start));
  const end = Math.max(...picked.map((s) => s.end));
  // Earliest picked becomes the survivor so a custom name stays with it.
  picked.sort((a, b) => a.start - b.start);
  const survivor = picked[0];
  survivor.start = start;
  survivor.end = end;
  survivor.selected = false;
  // Remove the other picked songs — and any song that now sits entirely
  // inside the merged span, so a middle song doesn't linger as a redundant
  // duplicate slice of the new merged file.
  state.songs = state.songs.filter((s) => {
    if (s.id === survivor.id) return true;
    if (s.selected) return false; // other picks
    if (s.start >= start && s.end <= end) return false; // swallowed
    return true;
  });
  sortSongs();
  refreshAutoNames();
  renderSongs();
  drawViz();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.addEventListener("resize", () => {
  if (state.features.length) drawViz();
});
