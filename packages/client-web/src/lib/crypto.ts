// Kompatibel zum alten Single-File-Client (matrix_tool_beta.html):
//   const CRYPTO = {PBKDF2_ITERATIONS:100000, IV_BYTES:12, SALT_BYTES:16, HASH:'SHA-256', KEY_LEN:256};
//   const ENC_PREFIX = 'IMATRIX_ENC:';
//   .imx-File enthaelt: 'IMATRIX_ENC:' + btoa(salt|iv|ciphertext)
//
// Parameter muessen bit-identisch bleiben, sonst entschluesselt der Dump nicht.

export const ENC_PREFIX = 'IMATRIX_ENC:';
const PBKDF2_ITERATIONS = 100_000;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const HASH = 'SHA-256';
const KEY_LEN = 256;

export function isEncrypted(text: string): boolean {
  return typeof text === 'string' && text.startsWith(ENC_PREFIX);
}

async function deriveKey(pw: string, salt: Uint8Array): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pw),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  // TS 5.7: Uint8Array<ArrayBufferLike> erfuellt nicht BufferSource-Constraint
  // (verlangt ArrayBufferView<ArrayBuffer>). Cast am Aufrufpunkt reicht,
  // da salt zur Laufzeit ein echter Uint8Array<ArrayBuffer> ist.
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: HASH },
    km,
    { name: 'AES-GCM', length: KEY_LEN },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Gegenstueck zu decryptPayload: Klartext + Passphrase → IMATRIX_ENC:-
// String. Salt + IV werden kryptographisch zufaellig erzeugt und an
// den Ciphertext vorangestellt. Format:
//   [salt:16B][iv:12B][ciphertext+authTag:*] → base64 → ENC_PREFIX + b64
// Bit-identisch zum HTML-Client (matrix_tool_beta.html:1752 ff), damit
// .imx-Dateien zwischen Standalone und SaaS round-trippen.
export async function encryptPayload(plain: string, pw: string): Promise<string> {
  if (typeof plain !== 'string') {
    throw new Error('Klartext muss ein String sein.');
  }
  if (!pw) {
    throw new Error('Passphrase darf nicht leer sein.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(pw, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  const ct = new Uint8Array(ctBuf);
  // salt | iv | ct zusammenfuegen und base64en.
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  // btoa() erwartet Latin-1-String — chunked encoden, damit grosse
  // Payloads nicht an Stack-Limits laufen.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < out.length; i += CHUNK) {
    bin += String.fromCharCode(...out.subarray(i, i + CHUNK));
  }
  return ENC_PREFIX + btoa(bin);
}

export async function decryptPayload(encoded: string, pw: string): Promise<string> {
  if (!isEncrypted(encoded)) {
    throw new Error('Datei ist nicht verschluesselt (kein IMATRIX_ENC:-Prefix).');
  }
  const b64 = encoded.slice(ENC_PREFIX.length).trim();
  let raw: string;
  try {
    raw = atob(b64);
  } catch {
    throw new Error('Base64-Inhalt ist korrupt.');
  }
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  if (buf.length < SALT_BYTES + IV_BYTES + 1) {
    throw new Error('Datei ist zu kurz fuer einen gueltigen Cipher-Block.');
  }
  const salt = buf.slice(0, SALT_BYTES);
  const iv = buf.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ct = buf.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(pw, salt);
  try {
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
  } catch {
    throw new Error('Passwort falsch oder Datei beschaedigt.');
  }
}
