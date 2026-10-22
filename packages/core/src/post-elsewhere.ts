/**
 * Posting a timelapse on Instagram, TikTok or X. Komodon sends nothing to them itself: a web
 * page can't hand a file to another site, so on a phone the video goes through the share
 * menu, where the apps are, and on a computer it downloads while the site's upload page
 * opens in a new tab. Each site's rules here were checked on 2026-10-22.
 */

export type PostPlatform = 'instagram' | 'tiktok' | 'x';

export interface PostPlatformInfo {
  /** The name people know it by. */
  name: string;
  /** Where posting starts on a computer. */
  uploadUrl: string;
  /** What to do there once the video has downloaded, in a sentence. */
  nextStep: string;
}

/** In the order the buttons show. */
export const POST_PLATFORMS: readonly PostPlatform[] = ['instagram', 'tiktok', 'x'];

export const POST_PLATFORM_INFO: Record<PostPlatform, PostPlatformInfo> = {
  instagram: {
    name: 'Instagram',
    // instagram.com has no address for its Create dialog; it opens from the side bar.
    uploadUrl: 'https://www.instagram.com/',
    nextStep: 'On Instagram, press Create and choose it.',
  },
  tiktok: {
    name: 'TikTok',
    uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload',
    nextStep: 'Choose it on TikTok’s upload page.',
  },
  x: {
    name: 'X',
    // X's documented web intent: its composer, where the video is added.
    uploadUrl: 'https://x.com/intent/tweet',
    nextStep: 'Add it to your post on X.',
  },
};

/** The longest video X takes from an account without Premium (help.x.com). */
export const X_MAX_SECONDS = 140;

/**
 * Why the video might not go up somewhere, said before trying: Instagram and X take MP4 or
 * MOV, not WebM (which a browser makes when it can't make an MP4; TikTok takes either), and
 * X takes up to 2 min 20 s without Premium. Instagram's and TikTok's length limits run to
 * many minutes and vary by account, so they aren't guessed at here.
 */
export function postElsewhereNote(video: { seconds: number; mime: string }): string | null {
  if (!video.mime.startsWith('video/mp4'))
    return 'This browser made a WebM video, which Instagram and X don’t take. Chrome, Edge and Safari make an MP4.';
  if (video.seconds > X_MAX_SECONDS)
    return 'Without Premium, X takes videos up to 2 min 20 s. Change it to a shorter length to post it there.';
  return null;
}
