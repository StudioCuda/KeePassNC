// Web Worker: liest einen QR-Code aus Bildpunkten (jsQR, Apache-2.0). Eigene Datei neben keepassnc.js, damit das Haupt-Skript schlank bleibt.
import jsQR from 'jsqr';

self.onmessage = ({ data }) => {
    const hit = jsQR(data.pixels, data.width, data.height);
    self.postMessage(hit ? hit.data : null);
};
