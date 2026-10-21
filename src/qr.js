// Read a QR code from an image (e.g. a screenshot of a TOTP setup). The image is only processed here in the browser.
import { workerUrl } from './argon2.js';

const scriptSrc = typeof document !== 'undefined' ? document.currentScript?.src : '';
const QR_WORKER_URL = scriptSrc && typeof Worker !== 'undefined' ? workerUrl(scriptSrc, 'keepassnc-qr.js') : null;
const MAX_SIDE = 1600; // scale larger images down: faster, and QR codes stay readable

/** Text of the QR code in the image file or null (no code found). Throws if the image is unreadable or no worker starts. */
export async function readQr(file) {
    if (!QR_WORKER_URL) throw new Error('QR worker unavailable');
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const { data, width, height } = g.getImageData(0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
        const w = new Worker(QR_WORKER_URL);
        w.onmessage = (e) => { w.terminate(); resolve(e.data); };
        w.onerror = (e) => { e.preventDefault?.(); w.terminate(); reject(new Error(e.message || 'QR worker error')); };
        w.postMessage({ pixels: data, width, height }, [data.buffer]);
    });
}
