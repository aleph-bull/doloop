/** The largest video a post may carry; the API refuses more. */
export const POST_VIDEO_MAX_BYTES = 5 * 1024 * 1024;
/** The largest picture a post may carry. */
export const POST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
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

/** Why a file cannot be posted, or null when it can. */
export function mediaProblem(file: Blob): string | null {
  const type = file.type.split(';')[0];
  if (type === 'video/mp4' || type === 'video/webm')
    return file.size > POST_VIDEO_MAX_BYTES
      ? 'Up to 5 MB. A shorter video, or a smaller one.'
      : null;
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')
    return file.size > POST_IMAGE_MAX_BYTES ? 'Up to 2 MB for a picture.' : null;
  return 'MP4, WebM, JPEG, PNG or WebP only.';
}

export const isVideo = (file: Blob) => file.type.startsWith('video/');
