/**
 * Posting a timelapse on Instagram, TikTok or X. Komodon sends nothing to them itself: a web
 * page can't hand a file to another site, so on a phone or tablet the video goes through the
 * share menu, where the apps are, and on a computer it downloads while the site's upload page
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
  /** The same in the app, on a phone that can't share files. */
  appNextStep: string;
  /** The link that opens the app on an iPhone or iPad (its URL scheme). */
  iosApp: string;
  /** The Android app, and an address of the site it answers, for Chrome's intent link. */
  android: { package: string; host: string };
}

/** In the order the buttons show. */
export const POST_PLATFORMS: readonly PostPlatform[] = ['instagram', 'tiktok', 'x'];

export const POST_PLATFORM_INFO: Record<PostPlatform, PostPlatformInfo> = {
  instagram: {
    name: 'Instagram',
    // instagram.com has no address for its Create dialog; it opens from the side bar.
    uploadUrl: 'https://www.instagram.com/',
    nextStep: 'On Instagram, press Create and choose it.',
    appNextStep: 'On Instagram, press + and choose it.',
    // Meta's documented iPhone hook for opening the app.
    iosApp: 'instagram://app',
    android: { package: 'com.instagram.android', host: 'www.instagram.com' },
  },
  tiktok: {
    name: 'TikTok',
    uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload',
    nextStep: 'Choose it on TikTok’s upload page.',
    appNextStep: 'On TikTok, press + and choose it under Upload.',
    // The scheme TikTok's own SDK docs use to find the app; it isn't documented for opening it.
    iosApp: 'snssdk1233://',
    android: { package: 'com.zhiliaoapp.musically', host: 'www.tiktok.com' },
  },
  x: {
    name: 'X',
    // X's documented web intent: its composer, where the video is added.
    uploadUrl: 'https://x.com/intent/tweet',
    nextStep: 'Add it to your post on X.',
    appNextStep: 'Add it to your post on X.',
    // The app still answers twitter:// (undocumented); `post` opens its composer.
    iosApp: 'twitter://post',
    android: { package: 'com.twitter.android', host: 'x.com' },
  },
};

/**
 * The link that opens the app rather than the site, for a phone that can't share files.
 * On Android it is Chrome's intent link pinned to the app, which goes to the app's Play Store
 * page when it isn't installed (still the app, not the site).
 */
export function appLink(platform: PostPlatform, os: 'ios' | 'android'): string {
  const info = POST_PLATFORM_INFO[platform];
  if (os === 'ios') return info.iosApp;
  return `intent://${info.android.host}/#Intent;scheme=https;package=${info.android.package};end`;
}

/** Study time the way a caption says it: "45 min", "2 h", "1 h 30 min". */
export function studyTimeText(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** The line about the session, beside the switch for it: "1 h 30 min of focus on Calculus". */
export function sessionLine(minutes: number, subject: string | null): string {
  return `${studyTimeText(minutes)} of focus${subject ? ` on ${subject}` : ''}`;
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
