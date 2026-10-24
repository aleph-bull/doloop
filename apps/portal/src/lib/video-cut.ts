/**
 * Cutting a posted video down to the part kept, in the browser, with mediabunny (loaded only
 * when someone cuts, like compress.ts). A cut that starts on a key frame is copied as it is:
 * quick, and nothing is lost. Anywhere else the video is re-encoded at about its own bitrate,
 * so the cut lands where it was put and weighs no more than the part it keeps.
 */

import { blobToDataUrl } from './post-media';

/** How far from where it was put a copied cut may start, in seconds. */
const TOLERANCE = 0.1;
/** Below this a re-encoded cut is mush. */
const MIN_BITRATE = 400_000;

/** How long a video is, read from the file itself (a recorded WebM doesn't tell the player). */
export async function videoDuration(file: Blob): Promise<number> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    return await input.computeDuration();
  } finally {
    input.dispose();
  }
}

/** Small JPEGs of a video at each of `times`, decoded exactly there; null where one won't. */
export async function* videoStills(
  file: Blob,
  times: number[],
  height: number,
): AsyncGenerator<string | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !(await video.canDecode())) return;
    const width = Math.max(1, Math.round((height * video.displayWidth) / video.displayHeight));
    const sink = new mb.CanvasSink(video, { width, height, fit: 'fill' });
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (!frame) yield null;
      else if (frame.canvas instanceof HTMLCanvasElement)
        yield frame.canvas.toDataURL('image/jpeg', 0.7);
      else
        yield await blobToDataUrl(
          await frame.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }),
        );
    }
  } finally {
    input.dispose();
  }
}

export async function cutVideo(
  file: Blob,
  from: number,
  to: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const mb = await import('mediabunny');
  const webm = file.type.startsWith('video/webm');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("That file doesn't have a video in it.");
    const seconds = await input.computeDuration();
    const start = (output: InstanceType<typeof mb.Output>, copy: boolean) =>
      mb.Conversion.init({
        input,
        output,
        tracks: 'primary',
        trim: { start: from, end: to },
        copy: copy ? { mode: 'forced', boundaryTolerance: TOLERANCE } : { boundaryTolerance: 0 },
        video: copy
          ? {}
          : {
              quality: new mb.Quality({
                bitrate: Math.max(MIN_BITRATE, Math.round(((file.size * 8) / seconds) * 0.9)),
              }),
            },
        showWarnings: false,
      });
    const newOutput = () =>
      new mb.Output({
        format: webm
          ? new mb.WebMOutputFormat()
          : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new mb.BufferTarget(),
      });
    const keepsVideo = (c: Awaited<ReturnType<typeof start>>) =>
      c.isValid && c.utilizedTracks.some((t) => t.isVideoTrack());

    let output = newOutput();
    let conversion = await start(output, true);
    if (!keepsVideo(conversion)) {
      output = newOutput();
      conversion = await start(output, false);
    }
    if (!keepsVideo(conversion))
      throw new Error("This browser can't cut videos. Chrome or Edge can.");

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
    if (!buffer) throw new Error("Couldn't cut the video.");
    return new Blob([buffer], { type: webm ? 'video/webm' : 'video/mp4' });
  } finally {
    input.dispose();
  }
}
