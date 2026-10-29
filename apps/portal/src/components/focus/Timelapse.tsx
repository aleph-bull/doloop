import {
  appLink,
  applyTimelapseStyle,
  aspectRatio,
  clampTimelapseResolution,
  cleanNoteText,
  fmtBytes,
  minTimelapseResolution,
  LIVE_CLIP_MAX_SECONDS,
  phoneAspectRatio,
  planTimelapse,
  POST_PLATFORM_INFO,
  POST_PLATFORMS,
  postElsewhereNote,
  STORY_RATIO,
  TIMELAPSE_DEFAULT_STILL_BYTES,
  timelapseLook,
  timelapseOutputSize,
  timelapseSizeEstimate,
  trimIndices,
  type CameraSize,
  type PostPlatform,
  type TimelapseAspect,
  type TimelapseDevice,
  type TimelapseFormat,
  type TimelapseLengthMode,
  type TimelapseOptions,
  type TimelapseOrientation,
  type TimelapsePreset,
  type UserSettings,
} from '@komogon/core';
import {
  ChevronDown,
  Clapperboard,
  Download,
  LayoutTemplate,
  MonitorUp,
  RectangleHorizontal,
  RectangleVertical,
  Share2,
  Smartphone,
  Square,
  Video,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Input,
  Modal,
  ProgressBar,
  Reveal,
  Segmented,
  Select,
  Slider,
  Toggle,
  useToast,
} from '@komogon/ui';
import { isUpright, mobileOs } from '../../lib/device';
import { fmtMinutes } from '../../lib/format';
import { FALLBACK_LIMITS, posterFromImage, sendMedia } from '../../lib/post-media';
import type { PostSession } from '../../lib/api';
import { useCreatePost, useMe, useMediaLimits } from '../../lib/queries';
import { PlatformMark } from '../PlatformMark';
import {
  DEFAULT_SCREEN_BYTES,
  freeStorageBytes,
  isClipStill,
  knownCameraRatio,
  knownCameraSize,
  liveMarks,
  knownScreenRatio,
  measuredScreenBytes,
  measuredStillBytes,
  renderTimelapse,
  timelapseFileName,
  videoSupported,
  clipTime,
  stillTexts,
  type RecorderStatus,
  type ScreenStatus,
  type TimelapseLook,
  type TimelapseRecorder,
  type TimelapseSources,
} from '../../lib/timelapse';
import { NoteField } from './NoteField';
import { PostPreview } from './PostPreview';
import { RelayoutDialog } from './RelayoutDialog';
import { TimelapseStylePicker } from './TimelapseStylePicker';
import { TimelapseTrim } from './TimelapseTrim';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type TimelapseSettingsValue = UserSettings['timelapse'];

const SPEEDS = [60, 120, 300, 600, 1200, 3600];

/** Where the timelapse's own settings live, layout editor included. */
export const TIMELAPSE_SETTINGS_PATH = '/settings#timelapse';

/** The settings of one preset, opened: `/settings#timelapse-phone`. */
export const timelapseSettingsPath = (device: TimelapseDevice) =>
  `${TIMELAPSE_SETTINGS_PATH}-${device}`;

/** A change to one device's preset, as a settings patch. */
export function presetPatch(
  device: TimelapseDevice,
  p: Partial<TimelapsePreset>,
): DeepPartial<UserSettings> {
  return device === 'phone' ? { timelapsePhone: p } : { timelapse: p };
}

/** The preset a device records with. */
export const presetOf = (settings: UserSettings, device: TimelapseDevice): TimelapsePreset =>
  device === 'phone' ? settings.timelapsePhone : settings.timelapse;

/** The shape a video of this aspect comes out in, from what this browser knows of the camera. */
function videoRatio(
  aspect: TimelapseAspect,
  device: TimelapseDevice,
  o: TimelapseOrientation = 'upright',
): number {
  const camera = knownCameraRatio();
  return device === 'phone'
    ? phoneAspectRatio(aspect, o, camera)
    : aspectRatio(aspect, camera, knownScreenRatio());
}

/**
 * A link to the timelapse settings, opened at a device's preset when given. From the focus
 * screen it opens in a new tab, since leaving the focus screen would drop the stills; the
 * change reaches this tab when it is looked at again.
 */
export function TimelapseSettingsLink({
  children,
  newTab = false,
  device,
}: {
  children: React.ReactNode;
  newTab?: boolean;
  device?: TimelapseDevice;
}) {
  return (
    <Link
      to={device ? timelapseSettingsPath(device) : TIMELAPSE_SETTINGS_PATH}
      className="timelapse-link"
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
    >
      {children}
    </Link>
  );
}

/* ---------- the question ---------- */

export interface TimelapsePromptProps {
  open: boolean;
  onYes: () => void;
  onNo: () => void;
  onAlways: () => void;
  onNever: () => void;
  /** Where it records; a phone's answer opens the camera screen. */
  device?: TimelapseDevice;
}

/** Asked once when a session starts on the focus screen, unless told always or never. */
export function TimelapsePrompt({
  open,
  onYes,
  onNo,
  onAlways,
  onNever,
  device = 'computer',
}: TimelapsePromptProps) {
  return (
    <Modal
      open={open}
      onClose={onNo}
      title="Record a timelapse?"
      actions={
        <>
          <Button variant="ghost" onClick={onNever}>
            Never ask again
          </Button>
          <Button variant="ghost" onClick={onAlways}>
            Always record
          </Button>
          <Button onClick={onNo}>Not now</Button>
          <Button variant="primary" onClick={onYes}>
            Record
          </Button>
        </>
      }
    >
      <p className="muted text-sm">
        {device === 'phone'
          ? 'The camera opens with your timer on it. Prop your phone up and we take stills while you focus, then give you a timelapse in the end. '
          : 'We take stills from your computer’s camera and give you a timelapse in the end. '}
        <Link
          to={timelapseSettingsPath(device)}
          className="link-button"
          target="_blank"
          rel="noreferrer"
        >
          Change what it looks like
        </Link>
      </p>
    </Modal>
  );
}

export interface OrientationPromptProps {
  open: boolean;
  /** Which way the video goes, and whether to skip the question from now on. */
  onPick: (o: TimelapseOrientation, remember: boolean) => void;
  /** Closed without an answer: no recording this time. */
  onClose: () => void;
}

/** On a phone, before its camera opens: which way the video goes. */
export function OrientationPrompt({ open, onPick, onClose }: OrientationPromptProps) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Record horizontally or vertically?">
      <div className="tl-orient">
        <button
          type="button"
          className="tl-orient-pick"
          onClick={() => onPick('sideways', remember)}
        >
          <RectangleHorizontal size={30} strokeWidth={1.6} aria-hidden />
          Horizontal
        </button>
        <button
          type="button"
          className="tl-orient-pick"
          onClick={() => onPick('upright', remember)}
        >
          <RectangleVertical size={30} strokeWidth={1.6} aria-hidden />
          Vertical
        </button>
      </div>
      <Toggle checked={remember} onChange={setRemember} label="Remember my decision" />
    </Modal>
  );
}

/** A phone's "horizontal or vertical": asked each time, or the remembered answer. */
export function OrientationChoice({
  value,
  onChange,
}: {
  value: UserSettings['timelapsePhone']['orientation'];
  onChange: (patch: DeepPartial<UserSettings>) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">Horizontal or vertical</span>
      <Segmented
        ariaLabel="Horizontal or vertical"
        value={value}
        onChange={(v) =>
          onChange({
            timelapsePhone: { orientation: v as UserSettings['timelapsePhone']['orientation'] },
          })
        }
        options={[
          { value: 'ask', label: 'Ask' },
          { value: 'sideways', label: 'Horizontal' },
          { value: 'upright', label: 'Vertical' },
        ]}
      />
    </div>
  );
}

export interface ScreenPromptProps {
  open: boolean;
  /** Record the screen this session. Called from the click, which the browser's picker needs. */
  onYes: () => void;
  onNo: () => void;
}

/**
 * Asked each time a recording starts: the screen this session, or just the camera. Saying
 * no leaves the whole camera picture, with no space kept for the screen.
 */
export function ScreenPrompt({ open, onYes, onNo }: ScreenPromptProps) {
  return (
    <Modal
      open={open}
      onClose={onNo}
      title="Record your screen this time?"
      actions={
        <>
          <Button onClick={onNo}>Just the camera</Button>
          <Button variant="primary" onClick={onYes}>
            <MonitorUp size={14} aria-hidden /> Record my screen
          </Button>
        </>
      }
    >
      <p className="muted text-sm">
        Your screen goes in the video where you placed it in the{' '}
        <TimelapseSettingsLink newTab>timelapse layout</TimelapseSettingsLink>, and the browser asks
        which screen or window to share. Without it, the video is your camera alone.
      </p>
    </Modal>
  );
}

export interface CameraLinkPromptProps {
  open: boolean;
  onYes: () => void;
  onNo: () => void;
}

/** On a phone, while a computer records the same session: film for it from here. */
export function CameraLinkPrompt({ open, onYes, onNo }: CameraLinkPromptProps) {
  return (
    <Modal
      open={open}
      onClose={onNo}
      title="Film from this phone?"
      actions={
        <>
          <Button onClick={onNo}>Not now</Button>
          <Button variant="primary" onClick={onYes}>
            <Smartphone size={14} aria-hidden /> Film
          </Button>
        </>
      }
    >
      <p className="muted text-sm">Your computer is recording.</p>
    </Modal>
  );
}

/* ---------- while recording ---------- */

export interface TimelapseBadgeProps {
  recorder: TimelapseRecorder;
  /** Stills are only taken during focus; say so on a break. */
  capturing: boolean;
  /** Start or pick up the screen share; absent where the browser can't share a screen. */
  onShareScreen?: () => void;
  onStop: () => void;
}

/**
 * The top bar's "recording" pill: a dot, a tiny mirror of the camera, Live clip, a button to
 * share the screen when the share is waiting for a click or was stopped, and a stop.
 */
export function TimelapseBadge({
  recorder,
  capturing,
  onShareScreen,
  onStop,
}: TimelapseBadgeProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = recorder.stream;
  }, [recorder.stream]);
  const { clip } = recorder;
  return (
    <span className={`timelapse-badge${clip ? ' is-clip' : ''}`} role="status">
      {recorder.stream && (
        <video ref={ref} className="timelapse-preview" autoPlay muted playsInline />
      )}
      <span
        className={`timelapse-dot${capturing && recorder.live ? '' : ' is-idle'}`}
        aria-hidden
      />
      {recorder.remote && (
        <span className="timelapse-from" title="Filming from your phone">
          <Smartphone size={14} aria-label="Phone" />
        </span>
      )}
      <span className="tabular">
        {clip
          ? `Live clip ${clipTime(clip)}`
          : `${!recorder.live ? 'Waiting for the screen' : capturing ? 'Recording' : 'Waiting for focus'} · ${recorder.count}`}
      </span>
      {clip ? (
        <Button variant="ghost" size="sm" onClick={recorder.toggleClip}>
          Stop clip
        </Button>
      ) : (
        (recorder.canClip || recorder.clipsFull) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={recorder.toggleClip}
            disabled={recorder.clipsFull}
            title={
              recorder.clipsFull
                ? 'This recording has used up its live clips.'
                : `Films the camera at normal speed for up to ${LIVE_CLIP_MAX_SECONDS} seconds. L starts and stops it.`
            }
          >
            <Clapperboard size={14} aria-hidden /> Live clip
          </Button>
        )
      )}
      {onShareScreen && SCREEN_OFFER.has(recorder.screenStatus) && (
        <Button variant="ghost" size="sm" onClick={onShareScreen}>
          <MonitorUp size={14} aria-hidden /> Share screen
        </Button>
      )}
      <Button variant="ghost" size="sm" icon aria-label="Stop the timelapse" onClick={onStop}>
        <Square size={12} aria-hidden />
      </Button>
    </span>
  );
}

/** The screen isn't being shared, so the pill offers to share it. */
const SCREEN_OFFER = new Set<ScreenStatus>(['off', 'needs-click', 'ended', 'denied', 'error']);

/** What happened to the screen share, in a line, when it is worth saying. */
export function screenProblem(status: ScreenStatus): string | null {
  const rest = ' The camera keeps recording.';
  if (status === 'needs-click')
    return 'Press Share screen in the top bar to add your screen to the timelapse.';
  if (status === 'denied') return `Nothing was shared, so the screen is not being recorded.${rest}`;
  if (status === 'ended')
    return `Screen sharing stopped.${rest} Press Share screen to pick it up again.`;
  if (status === 'unavailable') return 'This browser cannot share a screen.';
  if (status === 'error') return `The screen could not be shared.${rest}`;
  return null;
}

/** What went wrong with the camera, in a line; `screen` when the screen records on without it. */
export function recorderProblem(status: RecorderStatus, screen = false): string | null {
  if (screen && (status === 'denied' || status === 'unavailable' || status === 'error'))
    return status === 'denied'
      ? 'Camera blocked. Recording the screen.'
      : 'No camera. Recording the screen.';
  if (status === 'denied') return 'The camera was blocked. Allow it in the address bar to record.';
  if (status === 'unavailable') return 'This browser has no camera to record with.';
  if (status === 'error') return 'The camera would not start. Is another app using it?';
  return null;
}

/* ---------- settings ---------- */

/** When a session starts: ask, always record, or never. Both presets share it. */
export function TimelapseRecordChoice({
  value,
  onChange,
}: {
  value: TimelapseSettingsValue['record'];
  onChange: (patch: DeepPartial<UserSettings>) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">When a session starts</span>
      <Segmented
        ariaLabel="When a session starts"
        value={value}
        onChange={(v) => onChange({ timelapse: { record: v as TimelapseSettingsValue['record'] } })}
        options={[
          { value: 'ask', label: 'Ask' },
          { value: 'always', label: 'Always record' },
          { value: 'never', label: 'Never' },
        ]}
      />
    </div>
  );
}

/**
 * A computer's video in its own shape, or tall for a story or a reel: on the "Your
 * timelapse" card, remembered for the next one.
 */
function FormatChoice({
  value,
  onChange,
}: {
  value: TimelapseFormat;
  onChange: (v: TimelapseFormat) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">Video</span>
      <Segmented
        ariaLabel="Video"
        value={value}
        onChange={onChange}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'story', label: 'Story / Reel' },
        ]}
      />
    </div>
  );
}

/**
 * How far the focus screen darkens while it records. The slider answers at once, with a
 * small clock beside it dimming the same amount; the setting is saved once it settles.
 */
export function DimField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  // A change from elsewhere (the other tab, a refetch) shows unless this one is mid-drag.
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!dirty.current) return;
    const id = window.setTimeout(() => {
      dirty.current = false;
      if (draft !== value) onChange(draft);
    }, 350);
    return () => window.clearTimeout(id);
  }, [draft, value, onChange]);
  const pct = Math.round(draft * 100);
  const words = pct === 0 ? 'Off' : `${pct}%`;
  const labelId = useId();
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        Dim the screen while recording
      </span>
      <div className="dim-row">
        <span className="dim-preview" aria-hidden>
          <span className="dim-preview-time tabular">25:00</span>
          <span className="dim-preview-shade" style={{ opacity: draft }} />
        </span>
        <Slider
          min={0}
          max={90}
          step={5}
          value={pct}
          aria-labelledby={labelId}
          aria-valuetext={pct === 0 ? 'Off' : `${pct}% darker`}
          onChange={(v) => {
            dirty.current = true;
            setDraft(v / 100);
          }}
        />
        <span className="dim-value tabular">{words}</span>
      </div>
    </div>
  );
}

export interface TimelapseSettingsProps {
  settings: UserSettings;
  /** Whose preset: the computer's or the phone's. */
  device: TimelapseDevice;
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /** Show the shared "when a session starts" choice too (the focus screen's controls). */
  withRecordChoice?: boolean;
  /** Recording now, and the switch for it, when a session is running. */
  recording?: boolean;
  onRecordingChange?: (next: boolean) => void;
  /** Offer a link to the layout editor, opening in a new tab (the focus screen). */
  linkToLayout?: boolean;
}

/** How the timelapse is asked for and how one preset's video comes out. */
export function TimelapseSettings({
  settings,
  device,
  onChange,
  withRecordChoice = false,
  recording,
  onRecordingChange,
  linkToLayout = false,
}: TimelapseSettingsProps) {
  const value = presetOf(settings, device);
  const set = (p: Partial<TimelapsePreset>) => onChange(presetPatch(device, p));
  const format = settings.timelapse.format;
  // A phone's video has two layouts; the break clock matters if either shows the time.
  const elapsedShown =
    value.layout.elapsed.visible ||
    (device === 'phone' && settings.timelapsePhone.sidewaysLayout.elapsed.visible);
  return (
    <div className="flex flex-col gap-3">
      {onRecordingChange && (
        <Toggle checked={!!recording} onChange={onRecordingChange} label="Record this session" />
      )}
      {withRecordChoice && (
        <TimelapseRecordChoice value={settings.timelapse.record} onChange={onChange} />
      )}
      {device === 'phone' && (
        <OrientationChoice value={settings.timelapsePhone.orientation} onChange={onChange} />
      )}
      <DimField value={value.dim} onChange={(dim) => set({ dim })} />
      <TimelapseTips device={device} linkToLayout={linkToLayout} />
      {linkToLayout && <QuickLooks settings={settings} device={device} onChange={onChange} />}
      <LengthFields
        value={value}
        onChange={set}
        ratio={
          device === 'computer' && format === 'story'
            ? STORY_RATIO
            : videoRatio(value.aspect, device)
        }
        camera={knownCameraSize()}
      />
      <SizeNote options={value} screen={device === 'computer' && value.layout.screen.visible} />
      <Toggle
        checked={value.recordBreaks}
        onChange={(v) => set({ recordBreaks: v })}
        label="Record breaks too"
      />
      {value.recordBreaks && elapsedShown && (
        <div className="field">
          <span className="field-label">During a break, the clock shows</span>
          <Segmented
            ariaLabel="What the clock shows during a break"
            value={value.breakClock}
            onChange={(v) => set({ breakClock: v as TimelapsePreset['breakClock'] })}
            options={[
              { value: 'break', label: 'Break time' },
              { value: 'running', label: 'Keeps counting' },
            ]}
          />
        </div>
      )}
      <Toggle
        checked={value.smooth}
        onChange={(v) => set({ smooth: v })}
        label="Smooth motion"
        description="Blends stills together, like a long exposure."
      />
      <Toggle
        checked={value.deflicker}
        onChange={(v) => set({ deflicker: v })}
        label="Even out the light"
        description="Takes out the flicker of the camera's auto exposure."
      />
    </div>
  );
}

/** A few short notes, folded until opened. */
function TimelapseTips({
  device,
  linkToLayout,
}: {
  device: TimelapseDevice;
  linkToLayout: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tl-tips">
      <button
        type="button"
        className="tl-tips-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={15} aria-hidden className="tl-tips-chevron" />
        Tips
      </button>
      <Reveal open={open}>
        <ul className="tl-tips-list">
          <li>Tap the screen to brighten it.</li>
          <li>
            {device === 'phone' ? 'Live clip' : 'Live clip (L)'} films at normal speed, up to{' '}
            {LIVE_CLIP_MAX_SECONDS} s.
          </li>
          {linkToLayout && (
            <li>
              <TimelapseSettingsLink newTab device={device}>
                Edit the layout
              </TimelapseSettingsLink>
            </li>
          )}
        </ul>
      </Reveal>
    </div>
  );
}

/**
 * The looks, on the focus screen: picked, they save at once to this device's preset, on
 * both its layouts at their own shapes: a phone's upright and sideways, a computer's own
 * and its story.
 */
function QuickLooks({
  settings,
  device,
  onChange,
}: {
  settings: UserSettings;
  device: TimelapseDevice;
  onChange: (patch: DeepPartial<UserSettings>) => void;
}) {
  const camera = knownCameraRatio();
  const screenRatio = knownScreenRatio();
  if (device === 'computer') {
    const c = settings.timelapse;
    const ratio = aspectRatio(c.aspect, camera, screenRatio);
    const story = c.format === 'story';
    return (
      <TimelapseStylePicker
        compact
        ratio={story ? STORY_RATIO : ratio}
        layout={story ? c.storyLayout : c.layout}
        screenRatio={screenRatio}
        onPick={(id) =>
          onChange({
            timelapse: {
              layout: applyTimelapseStyle(id, ratio, c.layout, screenRatio),
              storyLayout: applyTimelapseStyle(id, STORY_RATIO, c.storyLayout, screenRatio),
            },
          })
        }
      />
    );
  }
  const p = settings.timelapsePhone;
  const upright = isUpright();
  const ratioUp = phoneAspectRatio(p.aspect, 'upright', camera);
  const ratioSide = phoneAspectRatio(p.sidewaysAspect, 'sideways', camera);
  return (
    <TimelapseStylePicker
      compact
      ratio={upright ? ratioUp : ratioSide}
      layout={upright ? p.layout : p.sidewaysLayout}
      onPick={(id) =>
        onChange({
          timelapsePhone: {
            layout: applyTimelapseStyle(id, ratioUp, p.layout),
            sidewaysLayout: applyTimelapseStyle(id, ratioSide, p.sidewaysLayout),
          },
        })
      }
    />
  );
}

/**
 * What a recording takes up with these settings, from this webcam's measured stills, and a
 * word when that is unusually big or the disk is short.
 */
export async function timelapseSpaceWarning(
  options: TimelapseOptions,
  sources: TimelapseSources,
): Promise<string | null> {
  const est = timelapseSizeEstimate(options, stillBytesFor(sources));
  const free = await freeStorageBytes();
  if (free !== null && free < est.peakBytes * 2)
    return `Space is short: this timelapse needs about ${fmtBytes(est.peakBytes)} while recording and the browser has about ${fmtBytes(free)} left.`;
  if (est.big)
    return `This timelapse needs about ${fmtBytes(est.peakBytes)} while recording. A shorter length or a faster speed takes less.`;
  return null;
}

/** What one moment of the recording takes up: the camera's still, the screen's, or both. */
function stillBytesFor(sources: TimelapseSources): number | undefined {
  const camera = sources.camera ? (measuredStillBytes() ?? TIMELAPSE_DEFAULT_STILL_BYTES) : 0;
  const screen = sources.screen ? (measuredScreenBytes() ?? DEFAULT_SCREEN_BYTES) : 0;
  return camera + screen || undefined;
}

function SizeNote({ options, screen }: { options: TimelapsePreset; screen: boolean }) {
  // The screen is asked about each session; count it when it has a place in the layout.
  const sources = { camera: true, screen };
  const est = timelapseSizeEstimate(options, stillBytesFor(sources));
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void freeStorageBytes().then((f) => live && setFree(f));
    return () => {
      live = false;
    };
  }, []);
  const short = free !== null && free < est.peakBytes * 2;
  return (
    <p className="field-hint" role={short || est.big ? 'status' : undefined}>
      Needs about {fmtBytes(est.peakBytes)} while recording. The video ends up around{' '}
      {fmtBytes(est.videoBytes)}.
      {short && (
        <span className="timelapse-size-warn">
          {' '}
          The browser only has about {fmtBytes(free)} left, so free some space first.
        </span>
      )}
      {!short && est.big && (
        <span className="timelapse-size-warn">
          {' '}
          That is unusually big; a shorter length or a faster speed takes less.
        </span>
      )}
    </p>
  );
}

interface LengthFieldsProps {
  value: TimelapsePreset;
  onChange: (p: Partial<TimelapsePreset>) => void;
  /** The most frames per second the stills can fill, once there are some. */
  maxFps?: number;
  /** The video's shape and the camera's size, which decide how small it can be made. */
  ratio: number;
  camera: CameraSize | null;
}

/**
 * Auto, a set length, or a speed, the frame rate and the resolution. Shared by the settings
 * and the export.
 */
function LengthFields({ value, onChange, maxFps = 60, ratio, camera }: LengthFieldsProps) {
  const fpsMax = Math.max(1, Math.min(60, maxFps));
  return (
    <>
      <div className="field">
        <span className="field-label">How long it comes out</span>
        <Segmented
          ariaLabel="How long the timelapse comes out"
          value={value.lengthMode}
          onChange={(v) => onChange({ lengthMode: v as TimelapseLengthMode })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'length', label: 'Set length' },
            { value: 'speed', label: 'Speed' },
          ]}
        />
        {value.lengthMode !== 'length' && (
          <span className="field-hint">
            {value.lengthMode === 'auto'
              ? 'About 20 to 40 seconds.'
              : `Every second of video is ${value.speed / 60 >= 1 ? fmtMinutes(value.speed / 60) : `${value.speed} s`} of focus.`}
          </span>
        )}
      </div>
      {value.lengthMode === 'length' && (
        <SecondsInput
          value={value.lengthSeconds}
          onChange={(n) => onChange({ lengthSeconds: n })}
        />
      )}
      {value.lengthMode === 'speed' && (
        <Select
          label="Speed"
          value={String(value.speed)}
          onChange={(e) => onChange({ speed: Number(e.target.value) })}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </Select>
      )}
      <label className="flex flex-col gap-1">
        <span className="flex justify-between field-hint">
          <span>Frames per second</span>
          <span className="tabular">
            {Math.min(value.fps, fpsMax)}
            {fpsMax < 60 && ` (up to ${fpsMax} with these stills)`}
          </span>
        </span>
        <Slider
          min={1}
          max={fpsMax}
          step={1}
          value={Math.min(value.fps, fpsMax)}
          onChange={(v) => onChange({ fps: Math.round(v) })}
        />
      </label>
      <ResolutionField
        value={value.resolution}
        ratio={ratio}
        camera={camera}
        onChange={(resolution) => onChange({ resolution })}
      />
    </>
  );
}

/**
 * How big the video is made, in percent of full size, with the size in pixels. The slider
 * stops at the smallest the video's shape and camera allow (`minTimelapseResolution`) and
 * says so, without saying why (owner, 2026-10-22). It answers at once; the setting is saved
 * once it settles.
 */
function ResolutionField({
  value,
  ratio,
  camera,
  onChange,
}: {
  value: number;
  ratio: number;
  camera: CameraSize | null;
  onChange: (percent: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  // A change from elsewhere (the other tab, a refetch) shows unless this one is mid-drag.
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!dirty.current) return;
    const id = window.setTimeout(() => {
      dirty.current = false;
      if (draft !== value) onChange(draft);
    }, 350);
    return () => window.clearTimeout(id);
  }, [draft, value, onChange]);
  const min = minTimelapseResolution(ratio, camera);
  const shown = clampTimelapseResolution(draft, ratio, camera);
  const { w, h } = timelapseOutputSize(ratio, shown, camera);
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between field-hint">
        <span id={labelId}>Resolution</span>
        <span className="tabular">
          {shown}% · {w} × {h}
        </span>
      </span>
      <Slider
        min={min}
        max={100}
        step={1}
        value={shown}
        disabled={min >= 100}
        aria-labelledby={labelId}
        aria-valuetext={`${shown}%, ${w} by ${h}`}
        onChange={(v) => {
          dirty.current = true;
          setDraft(Math.round(v));
        }}
      />
      {shown <= min && <span className="field-hint">That’s as small as it goes.</span>}
    </div>
  );
}

/** The set length, saved once it is a length the video can be (5 s to 10 min). */
function SecondsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Math.round(Number(text));
  const valid = text.trim() !== '' && Number.isFinite(n) && n >= 5 && n <= 600;
  return (
    <Input
      label="Seconds"
      type="number"
      min={5}
      max={600}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Math.round(Number(e.target.value));
        if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= 5 && v <= 600) onChange(v);
      }}
      onBlur={() => {
        if (!valid) setText(String(value));
      }}
      hint={valid ? undefined : 'Between 5 and 600 seconds.'}
    />
  );
}

/* ---------- making the video ---------- */

export interface TimelapseExportProps {
  recorder: TimelapseRecorder;
  settings: UserSettings;
  /** Where the stills were taken, so the video follows that preset. */
  device: TimelapseDevice;
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /** True while the camera is still on; the video can be made once it stops. */
  recording: boolean;
  /** The video was saved, so the stills behind it are safe to lose. */
  onSaved?: () => void;
  /**
   * The sessions the stills came from, oldest first, so sharing can attach them to the post:
   * several when the recording went on into the next session (another task).
   */
  sessionIds?: string[];
  /**
   * What a post says about those sessions, for its preview: focus minutes, focus and breaks
   * together, and the tasks.
   */
  postSession?: { minutes: number; elapsedMinutes: number; subject: string | null } | null;
  /** When the first session started and, once over, the last ended: the video's start and end. */
  sessionSpan?: { startedAt: string; endedAt: string | null } | null;
  /** Which way a phone's video goes, picked before the camera opened. */
  orientation?: TimelapseOrientation | null;
  /** The made video as a file, or null once there is none: it can go along to the post box. */
  onVideo?: (file: File | null) => void;
}

/** The stills so far, how the video will come out, and the button that makes it. */
export function TimelapseExport({
  recorder,
  settings,
  device,
  onChange,
  recording,
  onSaved,
  sessionIds,
  postSession,
  sessionSpan,
  orientation,
  onVideo,
}: TimelapseExportProps) {
  const value = presetOf(settings, device);
  // A computer's video in its own shape or as a story. Held here as well, so the choice
  // shows at once while the setting saves.
  const [format, setFormatHere] = useState<TimelapseFormat>(settings.timelapse.format);
  useEffect(() => setFormatHere(settings.timelapse.format), [settings.timelapse.format]);
  const asStory = device === 'computer' && format === 'story';
  const { toast } = useToast();
  const share = useCreatePost();
  const limits = useMediaLimits().data ?? FALLBACK_LIMITS;
  /** The preview before sharing to Social is open. */
  const [previewOpen, setPreviewOpen] = useState(false);
  /** "Change layout?" is open over a moment of the video. */
  const [relayoutOpen, setRelayoutOpen] = useState(false);
  // The time of day in the video reads in the account's timezone, not the computer's.
  const timeZone = useMe().data?.user.timezone;
  const [progress, setProgress] = useState<number | null>(null);
  // `seconds` is the planned length; `played` is the length the player reads from the file.
  const [video, setVideo] = useState<{
    url: string;
    mime: string;
    blob: Blob;
    seconds: number;
    w: number;
    h: number;
  } | null>(null);
  const [played, setPlayed] = useState<{ url: string; seconds: number } | null>(null);
  // The video downloads once, whichever button asked first (Save, Instagram, TikTok or X):
  // the others say it's already there rather than adding another copy.
  const [downloadedUrl, setDownloadedUrl] = useState<string | null>(null);
  const downloaded = !!video && downloadedUrl === video.url;
  const abort = useRef<AbortController | null>(null);
  const count = recorder.count;
  // The trim, in seconds into the session; null keeps that end where the recording is.
  const [trim, setTrim] = useState<{ from: number | null; to: number | null }>({
    from: null,
    to: null,
  });
  // The text on this video, written once the recording stops; the next video starts empty.
  const [noteText, setNoteText] = useState('');
  const all = recorder.stills();
  // With breaks in the stills the session's running time places them, else focused time.
  const timeKey = all.some((x) => x.breakSeconds !== null) ? 'totalSeconds' : 'workSeconds';
  const times = all.map((x) => x[timeKey]);
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  const [startAt, endAt] = trimIndices(times, trim.from, trim.to);
  const kept = endAt - startAt;
  const span = kept >= 2 ? times[endAt - 1]! - times[startAt]! : 0;
  const trimmed = trim.from !== null || trim.to !== null;
  const plan = useMemo(
    () => planTimelapse(kept, span, value, liveMarks(all.slice(startAt, endAt))),
    // The plan follows the stills kept; the span and the clips only change with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kept, startAt, value.lengthMode, value.lengthSeconds, value.speed, value.fps],
  );
  // Live clips in what is kept: how many frames, and how many clips.
  const clipStills = useMemo(
    () => all.slice(startAt, endAt).filter(isClipStill),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kept, startAt],
  );
  const clipCount = new Set(clipStills.map((s) => s.clip)).size;
  // A phone's video goes the way picked before it started; without that, the first kept
  // still says which way up.
  const upright = orientation ? orientation === 'upright' : (all[startAt]?.portrait ?? true);
  // The session's start and end; until it has ended, the end is the last still.
  const startMs = sessionSpan ? Date.parse(sessionSpan.startedAt) : (all[0]?.takenAt ?? null);
  const endMs = sessionSpan?.endedAt
    ? Date.parse(sessionSpan.endedAt)
    : (all[all.length - 1]?.takenAt ?? null);
  const look: TimelapseLook = useMemo(
    () => ({
      ...timelapseLook(
        settings,
        device,
        upright ? 'upright' : 'sideways',
        asStory ? 'story' : 'normal',
      ),
      timeZone,
      noteText: cleanNoteText(noteText),
      startAt: startMs,
      endAt: endMs,
      orientation: device === 'phone' ? (orientation ?? undefined) : undefined,
    }),
    [settings, device, upright, asStory, timeZone, noteText, startMs, endMs, orientation],
  );
  // The moment "Change layout?" arranges over: the middle of what the video keeps.
  const middleAt = Math.floor((startAt + Math.max(startAt, endAt - 1)) / 2);
  const middle = all[middleAt];
  const middleSample = useMemo(
    () =>
      middle
        ? {
            ...stillTexts(middle, look),
            progress: kept > 1 ? (middleAt - startAt) / (kept - 1) : 1,
          }
        : {},
    [middle, look, kept, middleAt, startAt],
  );

  // A video replaced or gone gives back its memory. Making one stops only when the card
  // goes: a remake clears the old video while the new one is already on its way.
  useEffect(
    () => () => {
      if (video) URL.revokeObjectURL(video.url);
    },
    [video],
  );
  useEffect(() => {
    const making = abort;
    return () => making.current?.abort();
  }, []);
  // The made video, for the post box Social opens after the session.
  useEffect(() => {
    onVideo?.(video ? videoFile(video) : null);
  }, [video, onVideo]);

  // On a phone or tablet the share sheet takes the video to the apps (on an iPhone, Apple's
  // share sheet), when this browser can share files.
  const os = mobileOs();
  const mobile = device === 'phone' || os !== null;
  const shareSheet = useMemo(
    () => mobile && !!video && !!navigator.canShare?.({ files: [videoFile(video)] }),
    [mobile, video],
  );

  if (count === 0) return null;

  /**
   * Make the video; `changes` stands in for the saved look while a save catches up. With
   * `share`, the post's preview opens once it is made.
   */
  const make = async (changes?: Partial<TimelapseLook>, share = false) => {
    if (!videoSupported()) return toast('This browser cannot make videos. Try Chrome or Edge.');
    // One at a time: a newer ask (another format) takes over from one still going.
    abort.current?.abort();
    const mine = new AbortController();
    abort.current = mine;
    setProgress(0);
    const using = { ...look, ...changes };
    try {
      const { blob, mime, w, h } = await renderTimelapse(
        recorder.stills().slice(startAt, endAt),
        plan,
        using,
        setProgress,
        mine.signal,
      );
      setVideo({
        url: URL.createObjectURL(blob),
        mime,
        blob,
        seconds: plan.durationSeconds,
        w,
        h,
      });
      if (share) setPreviewOpen(true);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        toast(err instanceof Error ? err.message : 'Could not make the video');
    } finally {
      if (abort.current === mine) setProgress(null);
    }
  };

  /**
   * The share sheet with the video. True when it is done with: shared, or closed (which is
   * not a failure); false when it can't open, so the caller falls back to a download.
   */
  const shareVideo = async (): Promise<boolean> => {
    if (!video) return true;
    try {
      await navigator.share({ files: [videoFile(video)] });
      onSaved?.();
      return true;
    } catch (err) {
      // A quick second tap finds the first sheet still open: that one is enough.
      return (
        err instanceof DOMException &&
        (err.name === 'AbortError' || err.name === 'InvalidStateError')
      );
    }
  };

  /** Download the video unless it already has been. False when it was already there. */
  const downloadOnce = (): boolean => {
    if (!video || downloaded) return false;
    downloadVideo(video);
    setDownloadedUrl(video.url);
    onSaved?.();
    return true;
  };

  const download = async () => {
    if (!video) return;
    // On a phone or tablet the share sheet is the way into Photos ("Save Video"); a download
    // would only land in Files. Called straight from the click, which the sheet needs.
    if (shareSheet && (await shareVideo())) return;
    if (!downloadOnce()) toast('It’s already in your downloads.');
  };

  /**
   * Hand the video to Instagram, TikTok or X, where the post is written in the app's or site's
   * own composer. On a phone or tablet the share sheet holds the apps and takes the video
   * along. Without it the video downloads (once, whichever button asked first): a phone then
   * opens the app, a computer the site in a new tab, and a toast says what to do there.
   * Called straight from the click, which the sheet, the app link and the new tab all need.
   */
  const postTo = async (platform: PostPlatform) => {
    if (!video) return;
    const site = POST_PLATFORM_INFO[platform];
    if (shareSheet && (await shareVideo())) return;
    const where = downloadOnce()
      ? 'The video is in your downloads.'
      : 'The video is already in your downloads.';
    if (os) {
      // After the save has rendered, so the focus screen's "leave this page?" is gone first.
      window.setTimeout(() => (window.location.href = appLink(platform, os)), 0);
      toast(`${where} ${site.appNextStep}`, { durationMs: 8000 });
      return;
    }
    window.open(site.uploadUrl, '_blank', 'noopener,noreferrer');
    toast(`${where} ${site.nextStep}`, { durationMs: 8000 });
  };

  /**
   * The video goes up as a post with what the preview said, and a still as its poster;
   * `blob` may be a compressed copy. Resolves true once it is up.
   */
  const shareToSocial = async (
    input: { body: string; showTime: boolean; showElapsed: boolean; friendsOnly: boolean },
    blob: Blob,
  ): Promise<boolean> => {
    try {
      // The poster is the middle of what the video kept, after any trim.
      const picture = middle?.blob ?? middle?.screen ?? null;
      const poster = picture ? await posterFromImage(picture) : null;
      await share.mutateAsync({
        body: input.body || undefined,
        sessionIds: sessionIds?.length ? sessionIds : undefined,
        showTime: input.showTime,
        showElapsed: input.showElapsed,
        friendsOnly: input.friendsOnly,
        ...(await sendMedia(blob, limits)),
        poster: poster ?? undefined,
      });
      toast('Shared to Social.');
      onSaved?.();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not share it');
      return false;
    }
  };

  const discard = () => {
    abort.current?.abort();
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    setPreviewOpen(false);
    setTrim({ from: null, to: null });
    setNoteText('');
    recorder.clear();
  };

  /** Saved in "Change layout?": the video is made again with it at once. */
  const remake = (changes: Partial<TimelapseLook>) => {
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    if (changes.noteText !== undefined) setNoteText(changes.noteText);
    void make(changes);
  };

  /** Normal or a story: saved for next time, and a video made or being made is made again. */
  const pickFormat = (next: TimelapseFormat) => {
    if (next === format) return;
    setFormatHere(next);
    onChange({ timelapse: { format: next } });
    if (!video && progress === null) return;
    const l = timelapseLook(settings, device, 'upright', next);
    remake({ aspect: l.aspect, layout: l.layout });
  };

  // What the post says about the session: the finished session's, else the stills' own time.
  const lastStill = all[Math.max(0, endAt - 1)];
  const session: PostSession | null = postSession
    ? {
        ...postSession,
        startedAt: sessionSpan?.startedAt ?? null,
        endedAt: sessionSpan?.endedAt ?? null,
      }
    : lastStill
      ? {
          minutes: Math.round(lastStill.workSeconds / 60),
          elapsedMinutes: Math.round(lastStill.totalSeconds / 60),
          subject: null,
          startedAt: null,
          endedAt: null,
        }
      : null;

  const postNote =
    video &&
    postElsewhereNote({
      seconds: played?.url === video.url ? played.seconds : video.seconds,
      mime: video.mime,
    });

  return (
    <section className="timelapse-export" aria-label="Timelapse">
      <div className="flex items-center gap-2">
        <Video size={16} aria-hidden />
        <h3 className="font-medium">Your timelapse</h3>
      </div>
      <p className="muted text-sm">
        {kept - clipStills.length} stills
        {clipCount > 0 &&
          ` and ${clipCount === 1 ? 'a live clip' : `${clipCount} live clips`} (${Math.max(1, Math.round(plan.liveSeconds))} s)`}{' '}
        from {fmtMinutes(span / 60)} of {timeKey === 'totalSeconds' ? 'the session' : 'focus'}
        {trimmed ? ', trimmed' : ''}. It comes out {Math.max(1, Math.round(plan.durationSeconds))} s
        at {plan.fps} fps
        {plan.short && ', shorter than asked: there are not enough stills yet'}.
      </p>
      <p className="field-hint">
        It follows your{' '}
        <TimelapseSettingsLink newTab device={device}>
          {device === 'phone'
            ? 'phone’s timelapse layout'
            : asStory
              ? 'story layout'
              : 'timelapse layout'}
        </TimelapseSettingsLink>
        : the shape, and where the clocks, the task name and the progress bar sit.
      </p>
      {device === 'computer' && <FormatChoice value={format} onChange={pickFormat} />}
      {video ? (
        <>
          <video
            className={`timelapse-video${video.h > video.w ? ' is-tall' : ''}`}
            src={video.url}
            controls
            playsInline
            loop
            onLoadedMetadata={(e) => {
              // A recorded WebM reads as endless; the planned length stands then.
              const seconds = e.currentTarget.duration;
              if (Number.isFinite(seconds) && seconds > 0) setPlayed({ url: video.url, seconds });
            }}
          />
          <p className="field-hint tabular">
            {video.w} × {video.h} · {fmtBytes(video.blob.size)}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => void download()}>
              <Download size={14} aria-hidden /> Save the video
            </Button>
            <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
              <Share2 size={14} aria-hidden /> Share to Social
            </Button>
            <Button variant="ghost" onClick={() => setRelayoutOpen(true)}>
              <LayoutTemplate size={14} aria-hidden /> Change layout?
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(video.url);
                setVideo(null);
              }}
            >
              Trim or change the length
            </Button>
            <Button variant="ghost" onClick={discard}>
              Throw it away
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="muted text-sm">Post it on</span>
            {/* The three stay on one line, under the words when there's no room beside them. */}
            <div className="flex gap-2">
              {POST_PLATFORMS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  onClick={() => void postTo(p)}
                  aria-label={`Post it on ${POST_PLATFORM_INFO[p].name}`}
                >
                  <PlatformMark platform={p} /> {POST_PLATFORM_INFO[p].name}
                </Button>
              ))}
            </div>
          </div>
          <p className="field-hint">
            {shareSheet
              ? `They open your ${device === 'phone' ? 'phone’s' : 'tablet’s'} share menu. Pick the app there.`
              : `${downloaded ? 'The video is in your downloads, and the' : 'The video downloads and the'} ${os ? 'app opens.' : 'site opens in a new tab.'}`}
            {postNote && ` ${postNote}`}
          </p>
          <PostPreview
            open={previewOpen}
            video={video}
            session={session}
            maxBytes={limits.videoMaxBytes}
            onShare={shareToSocial}
            onClose={() => setPreviewOpen(false)}
          />
        </>
      ) : progress !== null ? (
        <div className="flex flex-col gap-2">
          <ProgressBar value={progress} label="Making the timelapse" />
          <span className="field-hint">Making it in real time. Keep this tab open.</span>
          <div>
            <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          </div>
        </div>
      ) : (
        <>
          {count >= 3 && last > first && (
            <TimelapseTrim
              stills={all}
              times={times}
              first={first}
              last={last}
              from={trim.from ?? first}
              to={trim.to ?? last}
              startAt={startAt}
              endAt={endAt}
              plan={plan}
              look={look}
              wide={device === 'computer'}
              onChange={(from, to) =>
                setTrim({ from: from <= first ? null : from, to: to >= last ? null : to })
              }
            />
          )}
          <LengthFields
            value={value}
            onChange={(p) => onChange(presetPatch(device, p))}
            maxFps={plan.maxFps}
            ratio={videoRatio(look.aspect, device, upright ? 'upright' : 'sideways')}
            camera={knownCameraSize()}
          />
          {/* Written after the session, so only once the recording has stopped. */}
          {!recording && <NoteField value={noteText} onChange={setNoteText} />}
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => void make()} disabled={kept < 2}>
              Make the video
            </Button>
            {/* Straight to the post: made, then previewed. Only a finished session posts. */}
            {postSession && !recording && (
              <Button
                variant="secondary"
                onClick={() => void make(undefined, true)}
                disabled={kept < 2}
              >
                <Share2 size={14} aria-hidden /> Share to Social
              </Button>
            )}
            <Button variant="ghost" onClick={discard}>
              Throw the stills away
            </Button>
          </div>
          {recording && (
            <span className="field-hint">Stop recording to include the whole session.</span>
          )}
        </>
      )}
      {/* Outside the video's branch, so it can fade out while the video is made again. */}
      <RelayoutDialog
        open={relayoutOpen}
        onClose={() => setRelayoutOpen(false)}
        settings={settings}
        device={device}
        orientation={device === 'phone' ? (upright ? 'upright' : 'sideways') : null}
        format={asStory ? 'story' : 'normal'}
        onChange={onChange}
        still={middle}
        sample={middleSample}
        noteText={noteText}
        onRedraw={remake}
      />
    </section>
  );
}

/** The made video as a file named by the day, for the share sheet. */
function videoFile(video: { blob: Blob; mime: string }): File {
  return new File([video.blob], timelapseFileName(video.mime), {
    type: video.mime.split(';')[0],
  });
}

/** Download the made video: an anchor's click, so it needs nothing awaited first. */
function downloadVideo(video: { url: string; mime: string }) {
  const a = document.createElement('a');
  a.href = video.url;
  a.download = timelapseFileName(video.mime);
  a.click();
}
