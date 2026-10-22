/**
 * Shrinking a video or a picture in the browser so it fits under a post's limit. Videos are
 * re-encoded with WebCodecs through mediabunny, which is only loaded when someone actually
 * compresses something (it is a few hundred KB). Pictures are redrawn on a canvas as JPEG.
 */

/** Why compressing didn't work, worded for the person. */
export class CompressError extends Error {}

/** Room left for the container and for the encoder overshooting the bitrate it was given. */
const HEADROOM = 0.9;
/** Below this, a video is mush; better to say it's too long. */
const MIN_VIDEO_BITRATE = 150_000;

/** The longest side a video gets at a bitrate: more pixels only blur at low rates. */
function longSideFor(bitrate: number): number {
  if (bitrate >= 4_000_000) return 1920;
  if (bitrate >= 2_000_000) return 1280;
  if (bitrate >= 900_000) return 960;
  return 640;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Re-encode a video to fit in `maxBytes`, keeping its shape and sound. The bitrate comes
 * from the length; when the result still comes out too big (encoders overshoot), it tries
 * once more at a lower rate.
 */
export async function compressVideo(
  file: Blob,
  maxBytes: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined')
    throw new CompressError("This browser can't compress videos. Chrome or Edge can.");
  const mb = await import('mediabunny');

  let budget = maxBytes * HEADROOM;
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new CompressError("That file doesn't have a video in it.");
      const audio = await input.getPrimaryAudioTrack();
      const seconds = await input.computeDuration();
      if (!(seconds > 0)) throw new CompressError("Couldn't read how long the video is.");

      const total = (budget * 8) / seconds;
      const audioBitrate = audio ? (total > 1_000_000 ? 96_000 : 64_000) : 0;
      const videoBitrate = Math.floor(total - audioBitrate);
      if (videoBitrate < MIN_VIDEO_BITRATE)
        throw new CompressError(
          `It's too long to fit in ${Math.round(maxBytes / 1024 / 1024)} MB. A shorter clip would.`,
        );

      const w = video.displayWidth;
      const h = video.displayHeight;
      const scale = Math.min(1, longSideFor(videoBitrate) / Math.max(w, h));
      const stats = await video.computePacketStats(60).catch(() => null);
      // A 60 fps phone clip spends half its bits on frames nobody misses at this size.
      const frameRate = stats && stats.averagePacketRate > 31 ? 30 : undefined;

      const codec = (await mb.canEncodeVideo('avc', {
        width: even(w * scale),
        height: even(h * scale),
      }))
        ? 'avc'
        : (await mb.canEncodeVideo('vp9'))
          ? 'vp9'
          : null;
      if (!codec)
        throw new CompressError("This browser can't compress videos. Chrome or Edge can.");
      const webm = codec === 'vp9';

      const output = new mb.Output({
        format: webm
          ? new mb.WebMOutputFormat()
          : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new mb.BufferTarget(),
      });
      const conversion = await mb.Conversion.init({
        input,
        output,
        video: {
          width: even(w * scale),
          height: even(h * scale),
          fit: 'contain',
          frameRate,
          codec,
          quality: new mb.Quality({ bitrate: videoBitrate }),
          forceTranscode: true,
        },
        audio: audio
          ? {
              codec: webm ? 'opus' : 'aac',
              quality: new mb.Quality({ bitrate: audioBitrate }),
              forceTranscode: true,
            }
          : undefined,
      });
      if (!conversion.isValid)
        throw new CompressError("This browser can't read that video. Try an MP4.");

      conversion.onProgress = (p) => onProgress(p);
      const stop = () => void conversion.cancel();
      signal?.addEventListener('abort', stop);
      try {
        await conversion.execute();
      } catch (err) {
        if (err instanceof mb.ConversionCanceledError)
          throw new DOMException('Stopped', 'AbortError');
        throw err;
      } finally {
        signal?.removeEventListener('abort', stop);
      }

      const buffer = output.target.buffer;
      if (!buffer) throw new CompressError("Couldn't compress the video.");
      const blob = new Blob([buffer], { type: webm ? 'video/webm' : 'video/mp4' });
      if (blob.size <= maxBytes) return blob;
      // Overshot: aim lower by as much as it went over, then try once more.
      budget = budget * (maxBytes / blob.size) * HEADROOM;
    } finally {
      input.dispose();
    }
  }
  throw new CompressError(
    `Couldn't get it under ${Math.round(maxBytes / 1024 / 1024)} MB. A shorter clip would fit.`,
  );
}

/** Redraw a picture as a JPEG small enough for `maxBytes`, shrinking it if quality isn't enough. */
export async function compressImage(file: Blob, maxBytes: number): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new CompressError("Couldn't read that picture.");
  });
  try {
    let scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    for (let step = 0; step < 8; step++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new CompressError("Couldn't compress the picture.");
      // JPEG has no transparency; white is what a see-through PNG usually sits on.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.72]) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
        if (blob && blob.size <= maxBytes) return blob;
      }
      scale *= 0.75;
    }
  } finally {
    bmp.close();
  }
  throw new CompressError("Couldn't get the picture small enough.");
}
