import "./style.css";
import { zineify, splitPages, ORDER, FLIPPED, ROWS, COLS } from "./zine";
import type { Booklet } from "./booklet";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
};

const dropEl = $<HTMLElement>("#drop");
const fileInput = $<HTMLInputElement>("#file");
const pickBtn = $<HTMLButtonElement>("#pick");
const statusEl = $<HTMLElement>("#status");
const resultsEl = $<HTMLElement>("#results");
const viewerEl = $<HTMLElement>("#viewer");
const viewerName = $<HTMLElement>("#viewerName");
const viewerPage = $<HTMLElement>("#viewerPage");
const stageEl = $<HTMLElement>("#stage");

// ------- layout diagram -------

function cell(n: number, flipped: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = flipped ? "cell flipped" : "cell";
  // Show 1-based page numbers; tile 0 is page 1.
  el.textContent = String(n + 1);
  return el;
}

for (let i = 0; i < ROWS * COLS; i++) $("#inGrid").append(cell(i, false));
for (const tile of ORDER) $("#outGrid").append(cell(tile, FLIPPED.has(tile)));

// ------- status -------

function setStatus(msg: string, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", error);
  statusEl.classList.toggle("hidden", !msg);
}

// ------- booklet viewer -------

// three.js is loaded on first use so the formatter itself stays light.
let booklet: Booklet | null = null;

function pageLabel(turned: number, total: number): string {
  if (turned === 0) return "cover";
  if (turned === total) return "back cover";
  return `pages ${2 * turned}–${2 * turned + 1}`;
}

async function showBooklet(name: string, pages: HTMLCanvasElement[]) {
  if (!booklet) {
    const { Booklet } = await import("./booklet");
    viewerEl.classList.remove("hidden");
    booklet = new Booklet(stageEl);
    booklet.onChange = (turned, total) => {
      viewerPage.textContent = pageLabel(turned, total);
    };
  }
  viewerEl.classList.remove("hidden");
  viewerName.textContent = name;
  booklet.setPages(pages);
}

$("#prevPage").addEventListener("click", () => booklet?.prev());
$("#nextPage").addEventListener("click", () => booklet?.next());
$("#resetView").addEventListener("click", () => booklet?.resetView());

document.addEventListener("keydown", (e) => {
  if (!booklet || viewerEl.classList.contains("hidden")) return;
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "ArrowRight") booklet.next();
  else if (e.key === "ArrowLeft") booklet.prev();
  else return;
  e.preventDefault();
});

// A click (not a drag) on the stage turns the page: right half forward, left half back.
let downAt: { x: number; y: number } | null = null;
stageEl.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
stageEl.addEventListener("pointerup", (e) => {
  if (!booklet || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4) return;
  const rect = stageEl.getBoundingClientRect();
  if (e.clientX - rect.left > rect.width / 2) booklet.next();
  else booklet.prev();
});

// ------- processing -------

function outputName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}_zine.png`;
}

async function processFile(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = zineify(bitmap, bitmap.width, bitmap.height);
  const pages = splitPages(bitmap, bitmap.width, bitmap.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode png"))), "image/png"),
  );
  const url = URL.createObjectURL(blob);
  const name = outputName(file.name);

  const row = document.createElement("div");
  row.className = "result";

  const img = document.createElement("img");
  img.src = url;
  img.alt = name;

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("span");
  title.textContent = name;
  const dims = document.createElement("span");
  dims.className = "muted";
  dims.textContent = `${canvas.width} × ${canvas.height}`;
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.innerHTML = `<button type="button">download</button>`;
  const flip = document.createElement("button");
  flip.type = "button";
  flip.textContent = "flip through";
  flip.addEventListener("click", () => {
    showBooklet(name, pages);
    viewerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  meta.append(title, dims, link, flip);

  row.append(img, meta);
  resultsEl.prepend(row);
  await showBooklet(name, pages);
}

async function handleFiles(files: FileList | File[]) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) {
    setStatus("that doesn't look like an image.", true);
    return;
  }
  let failed = 0;
  for (const [i, file] of images.entries()) {
    setStatus(`formatting ${file.name} (${i + 1} of ${images.length})…`);
    try {
      await processFile(file);
    } catch (err) {
      console.error(err);
      failed++;
    }
  }
  setStatus(failed ? `couldn't open ${failed} of ${images.length} files.` : "", failed > 0);
}

// ------- drop zone -------

dropEl.addEventListener("click", () => fileInput.click());
pickBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  if (fileInput.files) handleFiles(fileInput.files);
  fileInput.value = "";
});
dropEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropEl.classList.add("dragover");
});
dropEl.addEventListener("dragleave", () => dropEl.classList.remove("dragover"));
dropEl.addEventListener("drop", (e) => {
  e.preventDefault();
  dropEl.classList.remove("dragover");
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});
