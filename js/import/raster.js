// Images and PDFs -> downscaled raster for use as a tracing underlay.

export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be opened')); i.src = src; });
}

/** Read an image file, downscale it to maxDim and return a JPEG data URL (white background) plus pixel size. */
export async function imageFileToData(file, maxDim = 2600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    return { dataURL: cv.toDataURL('image/jpeg', 0.85), w, h, origW: img.naturalWidth, origH: img.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

let pdfjs = null;
async function pdfLib() {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

export async function openPdf(file) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return doc;
}

/** Render page n (1-based) to a JPEG data URL. Returns page size in PDF points too. */
export async function renderPdfPage(doc, n, maxDim = 2600) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, maxDim / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { dataURL: cv.toDataURL('image/jpeg', 0.88), w: cv.width, h: cv.height, wPt: base.width, hPt: base.height };
}
