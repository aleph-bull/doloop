import {
  fmtBytes,
  planTimelapse,
  TIMELAPSE_DEFAULT_STILL_BYTES,
  timelapseClock,
  timelapseLook,
  timelapseSizeEstimate,
  trimIndices,
  type TimelapseDevice,
  type TimelapseLengthMode,
  type TimelapseOptions,
  type TimelapsePreset,
  type UserSettings,
} from '@komogon/core';
import { Download, MonitorUp, Share2, Square, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { fmtMinutes } from '../../lib/format';
import { FALLBACK_LIMITS, posterFromImage, sendMedia } from '../../lib/post-media';
import { useCreatePost, useMe, useMediaLimits } from '../../lib/queries';
import { CompressOffer } from '../social/CompressOffer';
import {
  DEFAULT_SCREEN_BYTES,
  freeStorageBytes,
  measuredScreenBytes,
  measuredStillBytes,
  renderTimelapse,
  screenSupported,
  timelapseFileName,
  videoSupported,
  type RecorderStatus,
  type ScreenStatus,
  type Still,
  type TimelapseRecorder,
  type TimelapseSources,
} from '../../lib/timelapse';
import { PhoneTrim } from './PhoneTrim';

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
 * The top bar's "recording" pill: a dot, a tiny mirror of the camera, a button to share the
 * screen when the share is waiting for a click or was stopped, and a stop.
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
  return (
    <span className="timelapse-badge" role="status">
      {recorder.stream && (
        <video ref={ref} className="timelapse-preview" autoPlay muted playsInline />
      )}
      <span
        className={`timelapse-dot${capturing && recorder.live ? '' : ' is-idle'}`}
        aria-hidden
      />
      <span className="tabular">
        {!recorder.live ? 'Waiting for the screen' : capturing ? 'Recording' : 'Waiting for focus'}{' '}
        · {recorder.count}
      </span>
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
      {device === 'computer' && screenSupported() && (
        <p className="field-hint">
          Each time a recording starts, you are asked whether to record your screen too.
        </p>
      )}
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
      <LengthFields value={value} onChange={set} />
      <SizeNote options={value} screen={device === 'computer' && value.layout.screen.visible} />
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
}: TimelapseExportProps) {
  const value = presetOf(settings, device);
  const { toast } = useToast();
  const share = useCreatePost();
  const [sharing, setSharing] = useState(false);
  const limits = useMediaLimits().data ?? FALLBACK_LIMITS;
  /** The video is over the post limit; the offer to compress it is showing. */
  const [oversize, setOversize] = useState(false);
  // The time of day in the video reads in the account's timezone, not the computer's.
  const timeZone = useMe().data?.user.timezone;
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<{ url: string; mime: string; blob: Blob } | null>(null);
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
    () => planTimelapse(kept, span, value),
    // The plan follows the stills kept; the span only changes with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kept, startAt, value.lengthMode, value.lengthSeconds, value.speed, value.fps],
  );
  // A phone's video keeps the shape it starts in: the first kept still says which way up.
  const upright = all[startAt]?.portrait ?? true;
  const look = {
    ...timelapseLook(settings, device, upright ? 'upright' : 'sideways'),
    timeZone,
  };

  useEffect(
    () => () => {
      abort.current?.abort();
      if (video) URL.revokeObjectURL(video.url);
    },
    [video],
  );

  if (count === 0) return null;

  const make = async () => {
    if (!videoSupported()) return toast('This browser cannot make videos. Try Chrome or Edge.');
    abort.current = new AbortController();
    setProgress(0);
    try {
      const { blob, mime } = await renderTimelapse(
        recorder.stills().slice(startAt, endAt),
        plan,
        look,
        setProgress,
        abort.current.signal,
      );
      setVideo({ url: URL.createObjectURL(blob), mime, blob });
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
      const file = new File([video.blob], timelapseFileName(video.mime), {
        type: video.mime.split(';')[0],
      });
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
    const a = document.createElement('a');
    a.href = video.url;
    a.download = timelapseFileName(video.mime);
    a.click();
    onSaved?.();
  };

  /**
   * The video goes up as a post with the session's minutes, and a still as its poster. Over
   * the limit, it offers to compress first; `blob` is then the compressed copy.
   */
  const shareToSocial = async (blob = video?.blob) => {
    if (!video || !blob) return;
    if (blob.size > limits.videoMaxBytes) return setOversize(true);
    setOversize(false);
    setSharing(true);
    try {
      // The poster comes from the middle of what the video kept, after any trim.
      const stills = recorder.stills().slice(startAt, endAt);
      const middle = stills[Math.floor(stills.length / 2)];
      const picture = middle?.blob ?? middle?.screen ?? null;
      const poster = picture ? await posterFromImage(picture) : null;
      await share.mutateAsync({
        sessionId: sessionId ?? undefined,
        ...(await sendMedia(blob, limits)),
        poster: poster ?? undefined,
      });
      toast('Shared to Social.');
      onSaved?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not share it');
    } finally {
      setSharing(false);
    }
  };

  const discard = () => {
    abort.current?.abort();
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    setOversize(false);
    setTrim({ from: null, to: null });
    recorder.clear();
  };

  return (
    <section className="timelapse-export" aria-label="Timelapse">
      <div className="flex items-center gap-2">
        <Video size={16} aria-hidden />
        <h3 className="font-medium">Your timelapse</h3>
      </div>
      <p className="muted text-sm">
        {kept} stills from {fmtMinutes(span / 60)} of{' '}
        {timeKey === 'totalSeconds' ? 'the session' : 'focus'}
        {trimmed ? ', trimmed' : ''}. It comes out {Math.max(1, Math.round(plan.durationSeconds))} s
        at {plan.fps} fps
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
          <video className="timelapse-video" src={video.url} controls playsInline loop />
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => void download()}>
              <Download size={14} aria-hidden /> Save the video
            </Button>
            <Button variant="secondary" onClick={() => void shareToSocial()} loading={sharing}>
              <Share2 size={14} aria-hidden /> Share to Social
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(video.url);
                setVideo(null);
                setOversize(false);
              }}
            >
              Change it
            </Button>
            <Button variant="ghost" onClick={discard}>
              Throw it away
            </Button>
          </div>
          {oversize && (
            <CompressOffer
              key={video.url}
              file={video.blob}
              maxBytes={limits.videoMaxBytes}
              actionLabel="Compress and share"
              onDone={(blob) => void shareToSocial(blob)}
              onCancel={() => setOversize(false)}
            />
          )}
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
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={make} disabled={kept < 2}>
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
    </section>
  );
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
