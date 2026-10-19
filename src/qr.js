// QR-Code aus einem Bild lesen (etwa der Screenshot einer TOTP-Einrichtung). Das Bild wird nur hier im Browser ausgewertet.
import { workerUrl } from './argon2.js';

const scriptSrc = typeof document !== 'undefined' ? document.currentScript?.src : '';
const QR_WORKER_URL = scriptSrc && typeof Worker !== 'undefined' ? workerUrl(scriptSrc, 'keepassnc-qr.js') : null;
const MAX_SIDE = 1600; // groessere Bilder verkleinern: schneller, und QR-Codes bleiben lesbar

/** Text des QR-Codes in der Bilddatei oder null (kein Code gefunden). Fehler, wenn das Bild unlesbar ist oder kein Worker startet. */
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
