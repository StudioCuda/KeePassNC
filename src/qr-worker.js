// Web Worker: reads a QR code from pixels (jsQR, Apache-2.0). Separate file next to keepassnc.js to keep the main script lean.
import jsQR from 'jsqr';

self.onmessage = ({ data }) => {
    const hit = jsQR(data.pixels, data.width, data.height);
    self.postMessage(hit ? hit.data : null);
};
