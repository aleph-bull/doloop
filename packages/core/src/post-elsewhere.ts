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
  /** The upload page with the caption already written in, where the site takes one. */
  withCaption?: (caption: string) => string;
  /** The longest caption the site takes, when it is short enough to run into. */
  captionMax?: number;
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
    // The intent takes the post's words as `text`.
    withCaption: (caption) => `https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`,
    captionMax: 280,
  },
};

/** Study time the way a caption says it: "45 min", "2 h", "1 h 30 min". */
export function studyTimeText(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** The line about the session: "1 h 30 min of focus on Calculus". */
export function sessionLine(minutes: number, subject: string | null): string {
  return `${studyTimeText(minutes)} of focus${subject ? ` on ${subject}` : ''}`;
}

/**
 * The words that go with a video posted elsewhere: what the person wrote, then the session's
 * line when they chose to show how long they studied. Empty when there is neither.
 */
export function postCaption(input: {
  text: string;
  session: { minutes: number; subject: string | null } | null;
  showTime: boolean;
}): string {
  const parts = [input.text.trim()];
  if (input.showTime && input.session && input.session.minutes > 0)
    parts.push(sessionLine(input.session.minutes, input.session.subject));
  return parts.filter(Boolean).join('\n\n');
}

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
