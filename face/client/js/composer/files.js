// The composer's attachment list: what is an image, the pre-checks on adding, the card and status lines, and the
// prompt's content parts. Pure, no DOM, no wire. A draft's `files` is a list of attachments, in the order added.
//   Attachment = {key, kind: 'image' | 'file', name, bytes, mediaType, blob, url?,
//                 status: 'ready' | 'uploading' | 'up' | 'failed', loaded, receiptId?, sessionId?}
//   Picked     = {key, name, bytes, mediaType, blob}   (one File, as app.js reads it)
// An image goes inline in the prompt as base64; any other file, an SVG or a HEIC included, uploads and goes as a receipt.

const MiB = 1048576;
const KiB = 1024;

/** dsh's image limits as the face assumes them until session/projections gives the session's own. */
export const DEFAULT_LIMITS = {
  maxImageBytes: 20971520, maxImagesPerMessage: 20, maxMessageImageBytes: 209715200,
  maxImagePixels: 64e6, maxImageDimension: 8192, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

const mb = bytes => Math.round(bytes / MiB);

/** 'image' when the limits' media types hold it, else 'file'. */
export function kindOf(mediaType, limits = DEFAULT_LIMITS) {
  return limits.mediaTypes.includes(mediaType) ? 'image' : 'file';
}

/** The picked files added to `files` in order, each 'ready'; an image over a limit is left out, the first refusal kept. */
export function admit(files, picked, limits = DEFAULT_LIMITS) {
  const out = [...files];
  let count = 0, total = 0, refusal = null;
  for (const f of files) if (f.kind === 'image') { count++; total += f.bytes; }
  for (const p of picked) {
    const kind = kindOf(p.mediaType, limits);
    if (kind === 'image') {
      let line = null;
      if (p.bytes > limits.maxImageBytes) line = `${p.name} is over ${mb(limits.maxImageBytes)} MB`;
      else if (count + 1 > limits.maxImagesPerMessage) line = `Up to ${limits.maxImagesPerMessage} images a message`;
      else if (total + p.bytes > limits.maxMessageImageBytes) line = `Images in one message: up to ${mb(limits.maxMessageImageBytes)} MB`;
      if (line) { refusal ??= line; continue; }
      count++; total += p.bytes;
    }
    out.push({ key: p.key, kind, name: p.name, bytes: p.bytes, mediaType: p.mediaType, blob: p.blob, status: 'ready', loaded: 0 });
  }
  return { files: out, refusal };
}

export const hasImage = files => files.some(f => f.kind === 'image');

/** What keeps a draft from sending: an upload in flight, else a failed one, else null. */
export function blocking(files) {
  if (files.some(f => f.status === 'uploading')) return 'uploading';
  if (files.some(f => f.status === 'failed')) return 'failed';
  return null;
}

const unitOf = bytes => (bytes < KiB ? 'B' : bytes < MiB ? 'KB' : 'MB');
function inUnit(bytes, unit) {
  if (unit === 'B') return String(bytes);
  if (unit === 'KB') return String(Math.round(bytes / KiB));
  return (bytes / MiB).toFixed(1);
}

/** Under 1,024 bytes `<n> B`; under 1 MiB `<n> KB`, rounded; else `<n.n> MB`. */
export function sizeText(bytes) {
  const unit = unitOf(bytes);
  return `${inUnit(bytes, unit)} ${unit}`;
}

/** An upload's progress in its total's unit: `1.1 / 2.8 MB`. */
export function progressText(loaded, total) {
  const unit = unitOf(total);
  return `${inUnit(loaded, unit)} / ${inUnit(total, unit)} ${unit}`;
}

/** The name's extension in capitals, 'FILE' with none (a dotfile or a trailing dot has none). */
export function extOf(name) {
  const dot = String(name ?? '').lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  return ext ? ext.toUpperCase() : 'FILE';
}

export const metaText = file => `${extOf(file.name)} · ${sizeText(file.bytes)}`;

export const limitsLine = limits => `Images: up to ${limits.maxImagesPerMessage} a message, ${mb(limits.maxImageBytes)} MB each`;

/** Above the box when the conversation's model takes no images; a bot's name stands for Gravit in its own conversation. */
export const modelRefusalLine = (name = 'Gravit') =>
  `${name}'s model takes no images. Remove the image, or run ${name} on a model that does.`;

const CHUNK = 0x8000;

/** Canonical base64 of a Uint8Array, built in chunks so a large array is never spread into one call. */
export function encodeBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** session/prompt's content: the text part when the words are not blank, then each attachment in the draft's order. */
export function contentParts(text, files, dataOf) {
  const parts = text.trim() ? [{ type: 'text', text }] : [];
  for (const f of files) {
    parts.push(f.kind === 'image'
      ? { type: 'image', mediaType: f.mediaType, data: dataOf(f.key), name: f.name }
      : { type: 'file', receiptId: f.receiptId });
  }
  return parts;
}

/** A history message's attachments (the mapper's `{type: 'image' | 'file', name?}`) by name, joined by ', '; an unnamed
 *  one reads as its type. */
export const attachmentsLine = list =>
  list.map(a => a.name || (a.type === 'image' ? 'image' : 'file')).join(', ');
