import { useEffect, useState } from 'react';
import {
  appLink,
  POST_PLATFORM_INFO,
  POST_PLATFORMS,
  sessionLine,
  type PostPlatform,
} from '@komogon/core';
import { Spinner, useToast } from '@komogon/ui';
import { api, postFiles, type FeedPost, type PostFile } from '../../lib/api';
import { mobileOs } from '../../lib/device';
import { PlatformMark } from '../PlatformMark';

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** One of the post's files as a file to hand over: from its R2 link, else from the API. */
async function fetchFile(post: FeedPost, f: PostFile, name: string): Promise<File> {
  let blob: Blob | null = null;
  try {
    const link = await api.postMediaUrl(post.id, f.n);
    if (link.url) {
      const res = await fetch(link.url);
      if (res.ok) blob = await res.blob();
    }
  } catch {
    /* the API passes R2 files through as well */
  }
  blob ??= await api.postMedia(post.id, f.n, f.bytes);
  return new File([blob], name, { type: f.mime });
}

/** "komogon-2026-11-03.mp4" (the day it was posted, here), numbered when it has several. */
function fileNames(post: FeedPost, files: PostFile[]): string[] {
  const at = new Date(post.createdAt);
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return files.map(
    (f, i) => `komogon-${day}${files.length > 1 ? `-${i + 1}` : ''}.${EXTENSIONS[f.mime] ?? 'bin'}`,
  );
}

/** Download a file: an anchor's click, so nothing is awaited first. */
function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Your post on Instagram, TikTok or X (2026-11-03), from the ⋯ under it. It hands the post's
 * files over the way the timelapse's buttons do (`postTo` in Timelapse.tsx): a phone's share
 * sheet, else a download and the app (a phone) or the site's upload page in a new tab (a
 * computer). The files are fetched as soon as this opens, because the share sheet and the
 * new tab only open straight from the tap. X takes the post's words too. A post without
 * files can only go on X, as words.
 */
export function PostElsewhere({ post, onDone }: { post: FeedPost; onDone: () => void }) {
  const { toast } = useToast();
  const files = postFiles(post);
  const [ready, setReady] = useState<File[] | null>(files.length ? null : []);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (files.length === 0) return;
    let live = true;
    const names = fileNames(post, files);
    Promise.all(files.map((f, i) => fetchFile(post, f, names[i]!)))
      .then((got) => live && setReady(got))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Fetched once for the files this post has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  const os = mobileOs();
  const sheet = !!ready?.length && os !== null && !!navigator.canShare?.({ files: ready });
  const platforms: readonly PostPlatform[] = files.length ? POST_PLATFORMS : ['x'];
  const words =
    post.body ||
    (files.length === 0 && post.session
      ? sessionLine(post.session.minutes, post.session.subject)
      : '');
  const what =
    files.length > 1
      ? 'They’re'
      : files[0]?.mime.startsWith('video/')
        ? 'The video is'
        : 'The picture is';
  const webm = files.some((f) => f.mime === 'video/webm');

  /** Called straight from the tap: the sheet, the app link and the new tab all need it. */
  const go = async (platform: PostPlatform) => {
    const site = POST_PLATFORM_INFO[platform];
    const url =
      platform === 'x' && words
        ? `${site.uploadUrl}?text=${encodeURIComponent(words)}`
        : site.uploadUrl;
    if (!ready) return;
    if (ready.length === 0) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return onDone();
    }
    if (sheet) {
      try {
        await navigator.share({ files: ready, ...(words ? { text: words } : {}) });
        return onDone();
      } catch (err) {
        // Closed, or a second tap while it's open: that's fine. Anything else downloads.
        if (
          err instanceof DOMException &&
          (err.name === 'AbortError' || err.name === 'InvalidStateError')
        )
          return onDone();
      }
    }
    if (os) {
      ready.forEach(download);
      window.setTimeout(() => (window.location.href = appLink(platform, os)), 0);
      toast(`${what} in your downloads. ${site.appNextStep}`, { durationMs: 8000 });
      return onDone();
    }
    // The site's tab opens before the download starts. The other way round, in one click,
    // crashes the whole of Vivaldi when it saves downloads without asking (2026-11-02).
    window.open(url, '_blank', 'noopener,noreferrer');
    ready.forEach(download);
    toast(`${what} in your downloads. ${site.nextStep}`, { durationMs: 8000 });
    onDone();
  };

  if (failed) return <span className="post-menu-note">Could not get the files.</span>;
  return (
    <>
      {platforms.map((p) => (
        <button
          key={p}
          type="button"
          role="menuitem"
          className="post-menu-item"
          disabled={!ready}
          onClick={() => void go(p)}
        >
          {ready ? <PlatformMark platform={p} /> : <Spinner className="post-menu-spin" />}
          {POST_PLATFORM_INFO[p].name}
        </button>
      ))}
      {webm && <span className="post-menu-note">A WebM video won’t go on Instagram or X.</span>}
    </>
  );
}
