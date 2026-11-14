// Image generation through the a6api gateway. Used by the `image_generate`
// tool (plugins/image-gen/index.ts) and runnable on its own:
//   node lib/image-gen.ts "a red apple on a wooden table" /tmp/apple.jpg
//
// Why this exists instead of OpenCode's built-in image model support: the
// gateway's /images/generations response carries `revised_prompt` (and an empty
// second field) on every item, and the OpenAI image protocol in OpenCode decodes
// the body strictly, so it answers "OpenAI Images returned an invalid response"
// for every request (measured 2026-11-14 with both `b64_json` and `url`
// response_format). Nothing in the config can drop an unexpected response field,
// so the call is made here and only the bytes are handed back.
//
// TypeScript, run by Node's own type stripping (Node >= 24): no build step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://a6api.vip/v1';
const DEFAULT_MODEL = 'nano-banana-2.1';
const REQUEST_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface GenerateImageOptions {
  prompt: string;
  /** Destination file, session-relative or absolute. */
  path?: string;
  /** Requested size, e.g. "1024x1024"; the gateway maps it to an aspect. */
  size?: string;
  /** Local paths or URLs used to edit the picture or as style/subject references. */
  images?: string[];
  model?: string;
  baseURL?: string;
  /** Base for a relative `path` (the session directory when called as a tool). */
  cwd?: string;
}

export interface GeneratedImage {
  path: string;
  model: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  requestedSize: string | null;
  revisedPrompt?: string;
  elapsedMs: number;
}

interface ImageItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

function authKey(): string {
  if (process.env.A6API_API_KEY) return process.env.A6API_API_KEY;
  const dataHome = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '/root', '.local', 'share');
  const file = path.join(dataHome, 'opencode', 'auth.json');
  try {
    const key = JSON.parse(fs.readFileSync(file, 'utf8'))?.a6api?.key;
    if (key) return key;
  } catch {}
  throw new Error('No a6api key: set A6API_API_KEY or store one in auth.json');
}

function sniff(buf: Buffer): string {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 4).toString('latin1') === 'PNG') return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  return 'bin';
}

// Dimensions straight from the container, so a caller can tell an actual
// aspect/size result apart from what it asked for.
function dimensions(buf: Buffer, format: string): { width?: number; height?: number } {
  try {
    if (format === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (format === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (format === 'webp') {
      const chunk = buf.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (format === 'jpg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const length = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + length;
      }
    }
  } catch {}
  return {};
}

function mediaType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

// A prompt is all the gateway needs to name a file after; keep it short and
// filesystem-safe so `generated/` stays readable.
function slug(text: string): string {
  return (text || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
}

/**
 * Generate (or edit, when `images` is given) one image and write it to disk.
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const { prompt, size, model, baseURL, cwd } = options;
  if (!prompt || !prompt.trim()) throw new Error('prompt is required');

  const key = authKey();
  const base = (baseURL || process.env.A6API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const modelID = model || process.env.A6API_IMAGE_MODEL || DEFAULT_MODEL;
  const images = options.images || [];
  const started = Date.now();

  let response: Response;
  if (images.length > 0) {
    // Edits take multipart; the field name is `image` and repeats per reference.
    const form = new FormData();
    form.append('model', modelID);
    form.append('prompt', prompt);
    if (size) form.append('size', size);
    for (const [index, ref] of images.entries()) {
      let bytes: Buffer;
      let type: string;
      if (/^https?:\/\//i.test(ref)) {
        const fetched = await fetch(ref, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!fetched.ok) throw new Error(`Failed to download reference ${ref}: HTTP ${fetched.status}`);
        bytes = Buffer.from(await fetched.arrayBuffer());
        type = fetched.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      } else {
        bytes = fs.readFileSync(path.resolve(cwd || process.cwd(), ref));
        type = mediaType(ref);
      }
      form.append('image', new Blob([bytes], { type }), `image-${index}${path.extname(ref) || '.jpg'}`);
    }
    response = await fetch(`${base}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } else {
    response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelID, prompt, n: 1, ...(size ? { size } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: ImageItem[]; error?: { message?: string }; msg?: string }
    | null;
  if (!response.ok) {
    const detail = body?.error?.message || body?.msg || JSON.stringify(body)?.slice(0, 200) || `HTTP ${response.status}`;
    throw new Error(`a6api ${response.status}: ${detail}`);
  }

  const item = body?.data?.[0];
  if (!item) throw new Error('a6api returned no image');

  let bytes: Buffer;
  if (item.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    // The gateway's URLs point at a temporary host, so the bytes are pulled
    // immediately instead of being handed back to the caller.
    const download = await fetch(item.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!download.ok) throw new Error(`Failed to download generated image: HTTP ${download.status}`);
    bytes = Buffer.from(await download.arrayBuffer());
  } else {
    throw new Error('a6api returned neither b64_json nor url');
  }

  const format = sniff(bytes);
  const baseDir = cwd || process.cwd();
  const requested = options.path
    ? path.resolve(baseDir, options.path)
    : path.join(baseDir, 'generated', `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug(prompt)}.${format}`);
  const target = path.extname(requested) && format !== 'bin'
    ? `${requested.slice(0, requested.length - path.extname(requested).length)}.${format}`
    : requested;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);

  return {
    path: target,
    model: modelID,
    format,
    bytes: bytes.length,
    ...dimensions(bytes, format),
    requestedSize: size || null,
    ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
    elapsedMs: Date.now() - started,
  };
}

// CLI: node lib/image-gen.ts "prompt" [out.jpg] [size]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [prompt, out, size] = process.argv.slice(2);
  if (!prompt) {
    console.error('usage: node lib/image-gen.ts "prompt" [out.jpg] [1024x1024]');
    process.exit(2);
  }
  generateImage({ prompt, path: out, size })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
