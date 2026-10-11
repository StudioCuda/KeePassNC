// Grobe Staerke-Schaetzung eines Passworts in Bit (bewusst einfach, ohne grosse Woerterbuecher - eine Orientierung, keine Garantie).
// Stufen wie in KeePassXC: <40 schlecht, <75 schwach, <100 gut, sonst sehr gut.
const COMMON = new Set(('password passwort 123456 12345678 123456789 1234567890 qwerty qwertz qwertyuiop asdfgh asdfghjkl zxcvbn iloveyou letmein welcome willkommen admin administrator root login master ' +
    'monkey dragon football fussball baseball sunshine princess shadow superman trustno1 abc123 passw0rd p@ssw0rd hallo hallo123 geheim secret changeme default test test123 user guest ' +
    'sommer winter fruehling herbst sommer2020 winter2020 summer winter spring autumn hello hunter michael jordan harley ranger buster soccer hockey killer george charlie thomas ' +
    'jennifer jessica daniel andrea martin sabine michael nicole maxmustermann mustermann schatz liebe sonne mond stern blume hase bayern berlin wien salzburg').split(' '));
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', 'qwertzuiopasdfghjklyxcvbnm', '01234567890', '1qaz2wsx3edc'];

export function charPool(pw) {
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[ !"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(pw)) pool += 33;
    if (/[^\x00-\x7F]/.test(pw)) pool += 100;
    return pool || 1;
}

export function estimateBits(pw) {
    if (!pw) return 0;
    const chars = [...pw]; // Zeichen statt UTF-16-Einheiten (Emoji)
    const lower = pw.toLowerCase();
    // Woerterbuch: Wort (+ Ziffern/Zeichen am Ende, Leetspeak) -> kaum Staerke
    const stripped = lower.replace(/[^a-z0-9äöüß]+$/g, '').replace(/[0-9]+$/g, '');
    const leet = lower.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a').replace(/\$/g, 's').replace(/[0-9!?.#]+$/g, '');
    if (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(leet)) return Math.min(estimateRaw(chars, pw) , 24);
    return estimateRaw(chars, pw);
}

function estimateRaw(chars, pw) {
    // Wiederholungen und Folgen zaehlen nur teilweise
    let effective = 0;
    const seen = new Map();
    const lower = pw.toLowerCase();
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        const prev = chars[i - 1];
        const count = (seen.get(c) || 0);
        seen.set(c, count + 1);
        let w = 1;
        if (prev === c) w = 0.1; // aaaa
        else if (count > 0) w = 0.5 + 0.5 / (count + 1); // bereits gesehenes Zeichen
        if (i >= 2) {
            const tri = lower.slice(i - 2, i + 1);
            if (SEQUENCES.some((s) => s.includes(tri) || [...s].reverse().join('').includes(tri))) w = Math.min(w, 0.15); // abc, 123, qwe
        }
        effective += w;
    }
    const bits = effective * Math.log2(charPool(pw));
    // Sehr kurze Passwoerter: nie ueber der Obergrenze der Zeichenzahl
    return Math.max(0, Math.min(bits, chars.length * 6.6));
}

export function strengthLabel(bits) {
    if (bits <= 0) return 'bad';
    if (bits < 40) return 'poor';
    if (bits < 75) return 'weak';
    if (bits < 100) return 'good';
    return 'excellent';
}
