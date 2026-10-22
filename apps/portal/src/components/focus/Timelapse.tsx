import {
  applyTimelapseStyle,
  aspectRatio,
  cleanEndText,
  endCardFrames,
  fmtBytes,
  LIVE_CLIP_MAX_SECONDS,
  phoneAspectRatio,
  planTimelapse,
  POST_PLATFORM_INFO,
  POST_PLATFORMS,
  postElsewhereNote,
  TIMELAPSE_DEFAULT_STILL_BYTES,
  TIMELAPSE_END_SECONDS,
  TIMELAPSE_END_TEXT_MAX,
  timelapseClock,
  timelapseLook,
  timelapseSizeEstimate,
  trimIndices,
  type PostPlatform,
  type TimelapseDevice,
  type TimelapseLengthMode,
  type TimelapseOptions,
  type TimelapsePreset,
  type UserSettings,
} from '@komogon/core';
import {
  Clapperboard,
  Download,
  LayoutTemplate,
  MonitorUp,
  Share2,
  Square,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Input,
  Modal,
  ProgressBar,
  Segmented,
  Select,
  Slider,
  Toggle,
  useToast,
} from '@komogon/ui';
import { isUpright } from '../../lib/device';
import { fmtMinutes } from '../../lib/format';
import { FALLBACK_LIMITS, posterFromImage, sendMedia } from '../../lib/post-media';
import { useCreatePost, useMe, useMediaLimits } from '../../lib/queries';
import { PlatformMark } from '../PlatformMark';
import {
  DEFAULT_SCREEN_BYTES,
  freeStorageBytes,
  isClipStill,
  knownCameraRatio,
  liveMarks,
  knownScreenRatio,
  measuredScreenBytes,
  measuredStillBytes,
  renderTimelapse,
  screenSupported,
  timelapseFileName,
  videoSupported,
  clipTime,
  clockText,
  timeOfDayText,
  type RecorderStatus,
  type ScreenStatus,
  type Still,
  type TimelapseLook,
  type TimelapseRecorder,
  type TimelapseSources,
} from '../../lib/timelapse';
import { PhoneTrim } from './PhoneTrim';
import { PostPreview, type PostTarget } from './PostPreview';
import { RelayoutDialog } from './RelayoutDialog';
import { TimelapseStylePicker } from './TimelapseStylePicker';

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

/** What went wrong with the camera, in a line. */
export function recorderProblem(status: RecorderStatus): string | null {
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
      <span className="field-hint">Tap the screen to brighten it for a moment.</span>
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
      <DimField value={value.dim} onChange={(dim) => set({ dim })} />
      {device === 'computer' && screenSupported() && (
        <p className="field-hint">
          Each time a recording starts, you are asked whether to record your screen too.
        </p>
      )}
      <p className="field-hint">
        {device === 'phone'
          ? `While recording, Live clip on the camera screen films at normal speed for up to ${LIVE_CLIP_MAX_SECONDS} seconds, for when there’s something to show the camera.`
          : `While recording, Live clip in the top bar (or the L key) films at normal speed for up to ${LIVE_CLIP_MAX_SECONDS} seconds, for when there’s something to show the camera.`}
      </p>
      {linkToLayout && (
        <p className="field-hint">
          {device === 'phone'
            ? 'Move, resize or remove the clocks, the task name and the progress bar, and pick the video’s shape upright and sideways, in '
            : 'Place the screen, move, resize or remove the clocks, the task name and the progress bar, and pick the video’s shape in '}
          <TimelapseSettingsLink newTab device={device}>
            the timelapse layout
          </TimelapseSettingsLink>
          .
        </p>
      )}
      {linkToLayout && <QuickLooks settings={settings} device={device} onChange={onChange} />}
      <LengthFields value={value} onChange={set} />
      <SizeNote options={value} screen={device === 'computer' && value.layout.screen.visible} />
      <EndTextField value={value.endText} onChange={(endText) => set({ endText })} />
      <Toggle
        checked={value.recordBreaks}
        onChange={(v) => set({ recordBreaks: v })}
        label="Record breaks too"
        description={
          device === 'phone'
            ? 'Breaks always show on the camera screen. This decides whether they go in the video.'
            : undefined
        }
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
          <span className="field-hint">
            {value.breakClock === 'break'
              ? 'A break clock, so the video shows when you were resting.'
              : 'The session’s running time, counting on through each break.'}
          </span>
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

/**
 * The looks, on the focus screen: picked, they save at once to this device's preset. A
 * phone's goes on both its layouts, upright and sideways, each at its own shape.
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
    return (
      <TimelapseStylePicker
        compact
        ratio={ratio}
        layout={c.layout}
        screenRatio={screenRatio}
        onPick={(_, layout) => onChange({ timelapse: { layout } })}
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
 * The person's words for the end of the video. Saved a moment after typing stops, and on
 * leaving the field; empty, the video has no end card.
 */
export function EndTextField({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  // A change saved elsewhere shows here, unless it is being typed in right now.
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const save = useCallback(
    (next: string) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      const clean = cleanEndText(next);
      if (clean !== value) onChange(clean);
    },
    [value, onChange],
  );
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Input
      label="Words at the end"
      value={text}
      maxLength={TIMELAPSE_END_TEXT_MAX}
      placeholder="Day 12 of finals"
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => save(next), 700);
      }}
      onBlur={() => {
        focused.current = false;
        save(text);
      }}
      hint={
        cleanEndText(text)
          ? `Shown over the last moment for ${TIMELAPSE_END_SECONDS} seconds as the video ends.`
          : 'Your own words on a card at the end. Leave it empty for none.'
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
}

/** Auto, a set length, or a speed, and the frame rate. Shared by the settings and the export. */
function LengthFields({ value, onChange, maxFps = 60 }: LengthFieldsProps) {
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
        <span className="field-hint">
          {value.lengthMode === 'auto'
            ? 'About 20 to 40 seconds for a long session, shorter for a short one.'
            : value.lengthMode === 'length'
              ? 'Exactly this long, if there are enough stills.'
              : `Every second of video is ${value.speed / 60 >= 1 ? fmtMinutes(value.speed / 60) : `${value.speed} s`} of focus.`}
        </span>
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
    </>
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
  /** The session the stills came from, so sharing can attach it to the post. */
  sessionId?: string | null;
  /** What a post says about that session, for its preview: focused minutes and the task. */
  postSession?: { minutes: number; subject: string | null } | null;
}

/** The stills so far, how the video will come out, and the button that makes it. */
export function TimelapseExport({
  recorder,
  settings,
  device,
  onChange,
  recording,
  onSaved,
  sessionId,
  postSession,
}: TimelapseExportProps) {
  const value = presetOf(settings, device);
  const { toast } = useToast();
  const share = useCreatePost();
  const limits = useMediaLimits().data ?? FALLBACK_LIMITS;
  /** Where the preview before posting is open for, if it is. */
  const [postTarget, setPostTarget] = useState<PostTarget | null>(null);
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
  } | null>(null);
  const [played, setPlayed] = useState<{ url: string; seconds: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const count = recorder.count;
  // The trim, in seconds into the session; null keeps that end where the recording is.
  const [trim, setTrim] = useState<{ from: number | null; to: number | null }>({
    from: null,
    to: null,
  });
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
  // A phone's video keeps the shape it starts in: the first kept still says which way up.
  const upright = all[startAt]?.portrait ?? true;
  const look: TimelapseLook = {
    ...timelapseLook(settings, device, upright ? 'upright' : 'sideways'),
    timeZone,
  };
  /** Seconds the words at the end add, for these words. */
  const endSeconds = (text: string | undefined) => endCardFrames(text, plan.fps) / plan.fps;
  // The moment "Change layout?" arranges over: the middle of what the video keeps.
  const middleAt = Math.floor((startAt + Math.max(startAt, endAt - 1)) / 2);
  const middle = all[middleAt];
  const middleSample = useMemo(
    () =>
      middle
        ? {
            clock: middle.takenAt ? timeOfDayText(middle.takenAt, timeZone) : null,
            elapsed: clockText(middle, value.breakClock),
            title: middle.title,
            progress: kept > 1 ? (middleAt - startAt) / (kept - 1) : 1,
          }
        : {},
    [middle, timeZone, value.breakClock, kept, middleAt, startAt],
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

  // On a phone the share sheet takes the video to the apps, when this browser can share files.
  const shareSheet = useMemo(
    () => device === 'phone' && !!video && !!navigator.canShare?.({ files: [videoFile(video)] }),
    [device, video],
  );

  if (count === 0) return null;

  /** Make the video; `changes` stands in for the saved look while a save catches up. */
  const make = async (changes?: Partial<TimelapseLook>) => {
    if (!videoSupported()) return toast('This browser cannot make videos. Try Chrome or Edge.');
    abort.current = new AbortController();
    setProgress(0);
    const using = { ...look, ...changes };
    try {
      const { blob, mime } = await renderTimelapse(
        recorder.stills().slice(startAt, endAt),
        plan,
        using,
        setProgress,
        abort.current.signal,
      );
      setVideo({
        url: URL.createObjectURL(blob),
        mime,
        blob,
        seconds: plan.durationSeconds + endSeconds(using.endText),
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        toast(err instanceof Error ? err.message : 'Could not make the video');
    } finally {
      setProgress(null);
    }
  };

  const download = async () => {
    if (!video) return;
    // On a phone the share sheet is the way into Photos ("Save Video"); a download would
    // only land in Files. Called straight from the click, which the sheet needs.
    if (device === 'phone') {
      const file = videoFile(video);
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          onSaved?.();
          return;
        } catch (err) {
          // Closing the sheet is not a failure; anything else falls back to a download.
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      }
    }
    downloadVideo(video);
    onSaved?.();
  };

  /**
   * Hand the video and its caption to Instagram, TikTok or X, from the preview's button. On
   * a phone the share sheet holds the apps and takes both along. A page can't pass a file to
   * another site, so elsewhere the video downloads and the site opens in a new tab, with the
   * caption written in where the site takes it (X) and copied to paste otherwise. Runs
   * straight from the click, which the sheet, the copy and the new tab all need.
   */
  const postTo = async (platform: PostPlatform, caption: string) => {
    if (!video) return;
    const site = POST_PLATFORM_INFO[platform];
    // Copied first, in the click: apps often drop the words a share menu hands them.
    const copied =
      caption && (shareSheet || !site.withCaption)
        ? (navigator.clipboard?.writeText(caption).then(
            () => true,
            () => false,
          ) ?? null)
        : null;
    if (shareSheet) {
      try {
        await navigator.share({ files: [videoFile(video)], ...(caption ? { text: caption } : {}) });
        onSaved?.();
        return;
      } catch (err) {
        // Closing the sheet is not a failure; anything else falls back to a download.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    downloadVideo(video);
    window.open(
      caption && site.withCaption ? site.withCaption(caption) : site.uploadUrl,
      '_blank',
      'noopener,noreferrer',
    );
    onSaved?.();
    const pasted = copied ? await copied : false;
    toast(
      pasted
        ? `The video is in your downloads and the caption is copied. ${site.nextStep} Paste the caption there.`
        : `The video is in your downloads. ${site.nextStep}`,
      { durationMs: 9000 },
    );
  };

  /**
   * The video goes up as a post with what the preview said, and a still as its poster;
   * `blob` may be a compressed copy. Resolves true once it is up.
   */
  const shareToSocial = async (
    input: { body: string; showTime: boolean },
    blob: Blob,
  ): Promise<boolean> => {
    try {
      // The poster is the middle of what the video kept, after any trim.
      const picture = middle?.blob ?? middle?.screen ?? null;
      const poster = picture ? await posterFromImage(picture) : null;
      await share.mutateAsync({
        body: input.body || undefined,
        sessionId: sessionId ?? undefined,
        showTime: input.showTime,
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
    setPostTarget(null);
    setTrim({ from: null, to: null });
    recorder.clear();
  };

  /** Saved in "Change layout?": the video is made again with it at once. */
  const remake = (changes: Partial<TimelapseLook>) => {
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    void make(changes);
  };

  // What the post says about the session: the finished session's, else the stills' own time.
  const lastStill = all[Math.max(0, endAt - 1)];
  const session =
    postSession ??
    (lastStill ? { minutes: Math.round(lastStill.workSeconds / 60), subject: null } : null);

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
        {trimmed ? ', trimmed' : ''}. It comes out{' '}
        {Math.max(1, Math.round(plan.durationSeconds + endSeconds(value.endText)))} s at {plan.fps}{' '}
        fps
        {plan.short && ', shorter than asked: there are not enough stills yet'}.
      </p>
      <p className="field-hint">
        It follows your{' '}
        <TimelapseSettingsLink newTab device={device}>
          {device === 'phone' ? 'phone’s timelapse layout' : 'timelapse layout'}
        </TimelapseSettingsLink>
        : the shape, and where the clocks, the task name and the progress bar sit.
      </p>
      {video ? (
        <>
          <video
            className="timelapse-video"
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
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => void download()}>
              <Download size={14} aria-hidden /> Save the video
            </Button>
            <Button variant="secondary" onClick={() => setPostTarget('social')}>
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
                  onClick={() => setPostTarget(p)}
                  aria-label={`Post it on ${POST_PLATFORM_INFO[p].name}`}
                >
                  <PlatformMark platform={p} /> {POST_PLATFORM_INFO[p].name}
                </Button>
              ))}
            </div>
          </div>
          <p className="field-hint">
            Each shows the post first, to add words and look it over before it goes.
            {postNote && ` ${postNote}`}
          </p>
          <PostPreview
            target={postTarget}
            video={{
              ...video,
              seconds: played?.url === video.url ? played.seconds : video.seconds,
            }}
            session={session}
            shareSheet={shareSheet}
            maxBytes={limits.videoMaxBytes}
            onShare={shareToSocial}
            onPostTo={(p, caption) => void postTo(p, caption)}
            onClose={() => setPostTarget(null)}
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
          {count >= 3 &&
            last > first &&
            (device === 'phone' ? (
              <PhoneTrim
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
                onChange={(from, to) =>
                  setTrim({ from: from <= first ? null : from, to: to >= last ? null : to })
                }
              />
            ) : (
              <TrimFields
                stills={all}
                first={first}
                last={last}
                from={trim.from ?? first}
                to={trim.to ?? last}
                startAt={startAt}
                endAt={endAt}
                onChange={(from, to) =>
                  setTrim({ from: from <= first ? null : from, to: to >= last ? null : to })
                }
              />
            ))}
          <LengthFields
            value={value}
            onChange={(p) => onChange(presetPatch(device, p))}
            maxFps={plan.maxFps}
          />
          <EndTextField
            value={value.endText}
            onChange={(endText) => onChange(presetPatch(device, { endText }))}
          />
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => void make()} disabled={kept < 2}>
              Make the video
            </Button>
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
        onChange={onChange}
        still={middle}
        sample={middleSample}
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

interface TrimFieldsProps {
  stills: Still[];
  /** The first and last still's time, seconds into the session. */
  first: number;
  last: number;
  /** Where the trim stands, in the same seconds. */
  from: number;
  to: number;
  /** The stills it keeps, [first, end). */
  startAt: number;
  endAt: number;
  onChange: (from: number, to: number) => void;
}

/**
 * Where the video starts and ends: two sliders over the recorded session, each with the
 * still it lands on, so the cut can be seen before the video is made.
 */
function TrimFields({ stills, first, last, from, to, startAt, endAt, onChange }: TrimFieldsProps) {
  // At least a few seconds of session between the two ends, so something is always kept.
  const gap = Math.max(1, Math.min(10, (last - first) / 20));
  const trimmed = from > first || to < last;
  return (
    <div className="field tl-trim">
      <span className="field-label">Trim</span>
      <div className="tl-trim-frames">
        <TrimFrame still={stills[startAt]} label={`Starts at ${timelapseClock(from)}`} />
        <TrimFrame
          still={stills[Math.max(startAt, endAt - 1)]}
          label={`Ends at ${timelapseClock(to)}`}
        />
      </div>
      <label className="flex flex-col gap-1">
        <span className="flex justify-between field-hint">
          <span>Start</span>
          <span className="tabular">{timelapseClock(from)}</span>
        </span>
        <Slider
          min={first}
          max={last}
          step={1}
          value={from}
          aria-label="Where the video starts"
          onChange={(v) => onChange(Math.min(Math.round(v), to - gap), to)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="flex justify-between field-hint">
          <span>End</span>
          <span className="tabular">{timelapseClock(to)}</span>
        </span>
        <Slider
          min={first}
          max={last}
          step={1}
          value={to}
          aria-label="Where the video ends"
          onChange={(v) => onChange(from, Math.max(Math.round(v), from + gap))}
        />
      </label>
      <span className="field-hint">
        {trimmed
          ? `Keeps ${timelapseClock(to - from)} of the ${timelapseClock(last - first)} recorded.`
          : 'Move the ends to cut the start or the end of the session out of the video.'}
      </span>
      {trimmed && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => onChange(first, last)}>
            Keep it all
          </Button>
        </div>
      )}
    </div>
  );
}

/** One still, as a small picture: the camera's, or the screen's when there is no camera. */
function TrimFrame({ still, label }: { still: Still | undefined; label: string }) {
  const blob = still?.blob ?? still?.screen ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <figure className="tl-trim-frame">
      {url && blob ? <img src={url} alt="" /> : <span className="tl-trim-empty" />}
      <figcaption className="field-hint tabular">{label}</figcaption>
    </figure>
  );
}
