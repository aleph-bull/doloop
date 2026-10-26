/**
 * The two timelapse presets: one for a computer, one for a phone. A recording follows the
 * preset of the device it is made on. The phone's has two layouts, upright and sideways,
 * and a video takes the one picked before the camera opened (`orientation`), or else the
 * one for how the phone was held when it started; turning the phone later doesn't change
 * its shape.
 */
import {
  aspectRatio,
  defaultTimelapseLayout,
  normalizeTimelapseLayout,
  type TimelapseAspect,
  type TimelapseLayout,
} from './timelapse-layout';
import { applyTimelapseStyle, cleanNoteText } from './timelapse-styles';
import type { TimelapsePreset, UserSettings } from './types';

export type TimelapseDevice = 'phone' | 'computer';
export type TimelapseOrientation = 'upright' | 'sideways';

/** Shapes a phone video can take when it starts upright. */
export const PHONE_UPRIGHT_ASPECTS: readonly TimelapseAspect[] = ['camera', '9:16', '4:5', '1:1'];
/** Shapes a phone video can take when it starts sideways. */
export const PHONE_SIDEWAYS_ASPECTS: readonly TimelapseAspect[] = ['camera', '16:9', '4:3', '1:1'];

const validRatio = (r: number | null | undefined): r is number =>
  typeof r === 'number' && Number.isFinite(r) && r > 0;

/** A camera's width over height, turned the way the phone is held (tall when upright). */
export function orientRatio(ratio: number | null | undefined, o: TimelapseOrientation): number {
  const r = validRatio(ratio) ? ratio : 16 / 9;
  const wide = Math.max(r, 1 / r);
  return o === 'upright' ? 1 / wide : wide;
}

/** Width over height for a phone shape held this way; 'camera' is the camera turned that way. */
export function phoneAspectRatio(
  aspect: TimelapseAspect,
  o: TimelapseOrientation,
  cameraRatio?: number | null,
): number {
  if (aspect === 'camera' || aspect === 'screen') return orientRatio(cameraRatio, o);
  return aspectRatio(aspect);
}

/** The phone's preset before anything is changed: the camera's shape, held either way. */
export function defaultPhoneTimelapse(): UserSettings['timelapsePhone'] {
  const upright = defaultTimelapseLayout(9 / 16);
  const sideways = defaultTimelapseLayout(16 / 9);
  return {
    lengthMode: 'auto',
    lengthSeconds: 30,
    speed: 300,
    fps: 30,
    smooth: true,
    deflicker: true,
    recordBreaks: false,
    breakClock: 'break',
    aspect: 'camera',
    resolution: 100,
    // A phone filming sits on the desk for the whole session: dark is kinder to its battery.
    dim: 0.7,
    layout: upright,
    sidewaysAspect: 'camera',
    sidewaysLayout: sideways,
    noteText: '',
    orientation: 'ask',
  };
}

const ORIENTATIONS: readonly UserSettings['timelapsePhone']['orientation'][] = [
  'ask',
  'upright',
  'sideways',
];

/**
 * The phone's preset read back from storage, made whole: each layout mended the way a
 * computer's is, the screen always out (a phone can't share one), and a shape that doesn't
 * fit how it is held put back to the camera's.
 */
export function normalizePhoneTimelapse(
  merged: UserSettings['timelapsePhone'],
  saved: Partial<Record<'layout' | 'sidewaysLayout' | 'noteText' | 'endText', unknown>> | undefined,
): UserSettings['timelapsePhone'] {
  const d = defaultPhoneTimelapse();
  const fix = (raw: unknown, fallback: TimelapseLayout) => {
    const l = normalizeTimelapseLayout(raw, fallback);
    l.screen.visible = false;
    return l;
  };
  return {
    ...merged,
    aspect: PHONE_UPRIGHT_ASPECTS.includes(merged.aspect) ? merged.aspect : 'camera',
    sidewaysAspect: PHONE_SIDEWAYS_ASPECTS.includes(merged.sidewaysAspect)
      ? merged.sidewaysAspect
      : 'camera',
    layout: fix(saved?.layout, d.layout),
    sidewaysLayout: fix(saved?.sidewaysLayout, d.sidewaysLayout),
    noteText: noteTextOf(saved),
    orientation: ORIENTATIONS.includes(merged.orientation) ? merged.orientation : 'ask',
  };
}

/**
 * The text on the video from a saved preset. For a day it was words on a card at the end
 * (`endText`); a preset with those and no text of its own shows them on the video instead.
 */
export function noteTextOf(
  saved: Partial<Record<'noteText' | 'endText', unknown>> | undefined,
): string {
  return cleanNoteText(saved?.noteText !== undefined ? saved.noteText : saved?.endText);
}

/**
 * A computer's video comes out in its own shape, or tall for a story or a reel. Each has its
 * own layout, so the tall one can be arranged for a phone screen.
 */
export type TimelapseFormat = 'normal' | 'story';
export const TIMELAPSE_FORMATS: readonly TimelapseFormat[] = ['normal', 'story'];
/** A story or a reel is always this shape. */
export const STORY_ASPECT: TimelapseAspect = '9:16';
export const STORY_RATIO = 9 / 16;

/** The computer's story layout before anything is changed: the Story look, screen at the top. */
export function defaultStoryLayout(screenRatio?: number): TimelapseLayout {
  return applyTimelapseStyle(
    'story',
    STORY_RATIO,
    defaultTimelapseLayout(STORY_RATIO, screenRatio),
    screenRatio,
  );
}

/**
 * What a recording follows: the computer's preset (its story layout for a story or a reel),
 * or the phone's with the shape and layout for the way its video goes.
 */
export function timelapseLook(
  settings: Pick<UserSettings, 'timelapse' | 'timelapsePhone'>,
  device: TimelapseDevice,
  o: TimelapseOrientation = 'upright',
  format: TimelapseFormat = 'normal',
): TimelapsePreset {
  if (device === 'computer') {
    const c = settings.timelapse;
    return format === 'story' ? { ...c, aspect: STORY_ASPECT, layout: c.storyLayout } : c;
  }
  const p = settings.timelapsePhone;
  return o === 'upright' ? p : { ...p, aspect: p.sidewaysAspect, layout: p.sidewaysLayout };
}
