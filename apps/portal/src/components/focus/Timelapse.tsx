import {
  planTimelapse,
  type TimelapseLengthMode,
  type UserSettings,
} from '@komogon/core';
import { Download, Square, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  renderTimelapse,
  timelapseFileName,
  videoSupported,
  type RecorderStatus,
  type TimelapseRecorder,
} from '../../lib/timelapse';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type TimelapseSettingsValue = UserSettings['timelapse'];

const SPEEDS = [60, 120, 300, 600, 1200, 3600];

/* ---------- the question ---------- */

export interface TimelapsePromptProps {
  open: boolean;
  onYes: () => void;
  onNo: () => void;
  onAlways: () => void;
  onNever: () => void;
}

/** Asked once when a session starts on the focus screen, unless told always or never. */
export function TimelapsePrompt({ open, onYes, onNo, onAlways, onNever }: TimelapsePromptProps) {
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
        Your camera takes a still every so often while you focus, and they become a short video of
        you studying. It all stays on this computer until you save the video. Change this any time
        in the focus screen&rsquo;s controls.
      </p>
    </Modal>
  );
}

/* ---------- while recording ---------- */

export interface TimelapseBadgeProps {
  recorder: TimelapseRecorder;
  /** Stills are only taken during focus; say so on a break. */
  capturing: boolean;
  onStop: () => void;
}

/** The top bar's "recording" pill: a dot, a tiny mirror of the camera, and a stop. */
export function TimelapseBadge({ recorder, capturing, onStop }: TimelapseBadgeProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = recorder.stream;
  }, [recorder.stream]);
  return (
    <span className="timelapse-badge" role="status">
      {recorder.stream && <video ref={ref} className="timelapse-preview" autoPlay muted playsInline />}
      <span className={`timelapse-dot${capturing ? '' : ' is-idle'}`} aria-hidden />
      <span className="tabular">
        {capturing ? 'Recording' : 'Waiting for focus'} · {recorder.count}
      </span>
      <Button variant="ghost" size="sm" icon aria-label="Stop the timelapse" onClick={onStop}>
        <Square size={12} aria-hidden />
      </Button>
    </span>
  );
}

/** What went wrong with the camera, in a line. */
export function recorderProblem(status: RecorderStatus): string | null {
  if (status === 'denied') return 'The camera was blocked. Allow it in the address bar to record.';
  if (status === 'unavailable') return 'This browser has no camera to record with.';
  if (status === 'error') return 'The camera would not start. Is another app using it?';
  return null;
}

/* ---------- settings ---------- */

export interface TimelapseSettingsProps {
  value: TimelapseSettingsValue;
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /** Recording now, and the switch for it, when a session is running. */
  recording?: boolean;
  onRecordingChange?: (next: boolean) => void;
}

/** How the timelapse is asked for and how the video comes out. */
export function TimelapseSettings({
  value,
  onChange,
  recording,
  onRecordingChange,
}: TimelapseSettingsProps) {
  const set = (p: Partial<TimelapseSettingsValue>) => onChange({ timelapse: p });
  return (
    <div className="flex flex-col gap-3">
      {onRecordingChange && (
        <Toggle
          checked={!!recording}
          onChange={onRecordingChange}
          label="Record this session"
          description="Stills are taken during focus, not breaks."
        />
      )}
      <div className="field">
        <span className="field-label">When a session starts</span>
        <Segmented
          ariaLabel="When a session starts"
          value={value.record}
          onChange={(v) => set({ record: v as TimelapseSettingsValue['record'] })}
          options={[
            { value: 'ask', label: 'Ask' },
            { value: 'always', label: 'Always record' },
            { value: 'never', label: 'Never' },
          ]}
        />
      </div>
      <LengthFields value={value} onChange={set} />
      <Toggle
        checked={value.showTimer}
        onChange={(v) => set({ showTimer: v })}
        label="Show time studied"
        description="A small clock in the corner of the video."
      />
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

interface LengthFieldsProps {
  value: TimelapseSettingsValue;
  onChange: (p: Partial<TimelapseSettingsValue>) => void;
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
        <SecondsInput value={value.lengthSeconds} onChange={(n) => onChange({ lengthSeconds: n })} />
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
  value: TimelapseSettingsValue;
  onChange: (patch: DeepPartial<UserSettings>) => void;
  /** True while the camera is still on; the video can be made once it stops. */
  recording: boolean;
  /** The video was saved, so the stills behind it are safe to lose. */
  onSaved?: () => void;
}

/** The stills so far, how the video will come out, and the button that makes it. */
export function TimelapseExport({
  recorder,
  value,
  onChange,
  recording,
  onSaved,
}: TimelapseExportProps) {
  const { toast } = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<{ url: string; mime: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const count = recorder.count;
  const span = recorder.spanSeconds();
  const plan = useMemo(
    () => planTimelapse(count, span, value),
    // The plan follows the count; the span only grows with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, value.lengthMode, value.lengthSeconds, value.speed, value.fps],
  );

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
        recorder.stills(),
        plan,
        value,
        setProgress,
        abort.current.signal,
      );
      setVideo({ url: URL.createObjectURL(blob), mime });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        toast(err instanceof Error ? err.message : 'Could not make the video');
    } finally {
      setProgress(null);
    }
  };

  const download = () => {
    if (!video) return;
    const a = document.createElement('a');
    a.href = video.url;
    a.download = timelapseFileName(video.mime);
    a.click();
    onSaved?.();
  };

  const discard = () => {
    abort.current?.abort();
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    recorder.clear();
  };

  return (
    <section className="timelapse-export" aria-label="Timelapse">
      <div className="flex items-center gap-2">
        <Video size={16} aria-hidden />
        <h3 className="font-medium">Your timelapse</h3>
      </div>
      <p className="muted text-sm">
        {count} stills from {fmtMinutes(span / 60)} of focus. It comes out{' '}
        {Math.max(1, Math.round(plan.durationSeconds))} s at {plan.fps} fps
        {plan.short && ', shorter than asked: there are not enough stills yet'}.
      </p>
      {video ? (
        <>
          <video className="timelapse-video" src={video.url} controls playsInline loop />
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={download}>
              <Download size={14} aria-hidden /> Save the video
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(video.url);
                setVideo(null);
              }}
            >
              Change it
            </Button>
            <Button variant="ghost" onClick={discard}>
              Throw it away
            </Button>
          </div>
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
          <LengthFields
            value={value}
            onChange={(p) => onChange({ timelapse: p })}
            maxFps={plan.maxFps}
          />
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={make} disabled={recording && count < 2}>
              Make the video
            </Button>
            <Button variant="ghost" onClick={discard}>
              Throw the stills away
            </Button>
          </div>
          {recording && (
            <span className="field-hint">Still recording; stop first for the whole session.</span>
          )}
        </>
      )}
    </section>
  );
}
