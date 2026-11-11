export function validateLogoFile(file) {
  if (!file || !['image/png', 'image/jpeg'].includes(file.type)) return 'Elige una imagen PNG o JPG.';
  if (!file.size) return 'El archivo está vacío. Elige otra imagen.';
  if (file.size > 2 * 1024 * 1024) return 'La imagen debe pesar como máximo 2 MB.';
  return '';
}

function loadImage(blob, signal) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), img = new Image();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); img.onload = null; img.onerror = null; URL.revokeObjectURL(url); };
    const fail = error => { cleanup(); img.src = ''; reject(error); };
    const abort = () => fail(new DOMException('Canceled', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('No se pudo leer la imagen. Elige otra imagen o vuelve a intentar.')), 8000);
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => fail(new Error('No se pudo leer la imagen. Elige un PNG o JPG válido.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    img.src = url;
  });
}

export async function prepareLogoFile(file, signal) {
  const error = validateLogoFile(file);
  if (error) throw new Error(error);
  const img = await loadImage(file, signal);
  if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > 4096 || img.naturalHeight > 4096) throw new Error('Usa una imagen de hasta 4096 × 4096 píxeles.');
  const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Tu navegador no pudo preparar la imagen. Intenta con otro navegador.');
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length > 180000) throw new Error('La imagen tiene demasiado detalle. Usa una versión más simple de tu logotipo.');
  return dataUrl;
}

export async function verifyQrSvg(svg, expectedUrl, signal) {
  const img = await loadImage(new Blob([svg], { type: 'image/svg+xml' }), signal);
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 1360;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No se pudo comprobar el QR. Prueba con otro navegador.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { default: jsQR } = await import('jsqr');
  if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const decoded = jsQR(pixels.data, pixels.width, pixels.height);
  if (decoded?.data !== expectedUrl) throw new Error('No pudimos verificar la lectura de este QR. Prueba sin logotipo o con un color más oscuro.');
}
