import { api, type MediaLimits, type NewPost } from './api';

/**
 * What to assume until the API says (GET /api/social/uploads): the limits without R2, the
 * smaller ones, so nothing is let through that the API would then refuse.
 */
export const FALLBACK_LIMITS: MediaLimits = {
  direct: false,
  videoMaxBytes: 5 * 1024 * 1024,
  imageMaxBytes: 2 * 1024 * 1024,
};
/** The poster's width; it is a thumbnail, not the video. */
const POSTER_WIDTH = 480;

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

function drawPoster(source: CanvasImageSource, width: number, height: number): string | null {
  const scale = Math.min(1, POSTER_WIDTH / Math.max(1, width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** A still from early in a video, as a small JPEG data URL; null when the browser cannot. */
export async function posterFromVideo(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Could not read the video'));
      video.src = url;
    });
    const at = Math.min(0.5, (video.duration || 0) / 3);
    if (at > 0 && Number.isFinite(at)) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = at;
      });
    }
    return drawPoster(video, video.videoWidth, video.videoHeight);
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

/** A JPEG still (the timelapse recorder's) shrunk into a poster. */
export async function posterFromImage(blob: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const out = drawPoster(bmp, bmp.width, bmp.height);
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

export const isVideo = (file: Blob) => file.type.startsWith('video/');

/** "38 MB", "740 KB", in the same 1024s as the limits (core's fmtBytes counts in 1000s). */
export const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / 1024 / 1024)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The most a file of this kind may weigh. */
export const maxBytesFor = (file: Blob, limits: MediaLimits) =>
  isVideo(file) ? limits.videoMaxBytes : limits.imageMaxBytes;

/**
 * Why a file cannot be posted as it is, or null when it can. A file that is only too big
 * comes back as `size`: it can be compressed to fit.
 */
export function mediaProblem(
  file: Blob,
  limits: MediaLimits,
): { kind: 'type'; message: string } | { kind: 'size'; maxBytes: number } | null {
  const type = file.type.split(';')[0];
  const known =
    type === 'video/mp4' ||
    type === 'video/webm' ||
    type === 'image/jpeg' ||
    type === 'image/png' ||
    type === 'image/webp';
  if (!known) return { kind: 'type', message: 'MP4, WebM, JPEG, PNG or WebP only.' };
  const maxBytes = maxBytesFor(file, limits);
  return file.size > maxBytes ? { kind: 'size', maxBytes } : null;
}

/** PUT a file to an upload link, reporting progress (fetch can't report an upload's). */
function putFile(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The upload didn't go through (${xhr.status}). Try again.`));
    xhr.onerror = () => reject(new Error("The upload didn't go through. Try again."));
    xhr.send(file);
  });
}

/**
 * Get a file ready to go with a post: uploaded straight to R2 when the API has it (the post
 * then names the key), or read into a data URL that goes with the post.
 */
export async function sendMedia(
  file: Blob,
  limits: MediaLimits,
  onProgress?: (fraction: number) => void,
): Promise<Pick<NewPost, 'media' | 'upload'>> {
  if (!limits.direct) return { media: await blobToDataUrl(file) };
  const mime = file.type.split(';')[0]!;
  const link = await api.startUpload(mime, file.size);
  await putFile(link.url, link.headers, file, onProgress);
  return { upload: link.key };
}
