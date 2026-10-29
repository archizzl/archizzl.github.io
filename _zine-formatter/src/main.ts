import "./style.css";
import { zineify, ORDER, FLIPPED, ROWS, COLS } from "./zine";

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

// ------- processing -------

function outputName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}_zine.png`;
}

async function processFile(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = zineify(bitmap, bitmap.width, bitmap.height);
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
  meta.append(title, dims, link);

  row.append(img, meta);
  resultsEl.prepend(row);
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
