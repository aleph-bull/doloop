import type { FocusContext } from '@komogon/core';
import {
  Clapperboard,
  Eye,
  EyeOff,
  Pause,
  PictureInPicture2,
  Play,
  SkipForward,
  Square,
  SwitchCamera,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@komogon/ui';
import { isUpright } from '../../lib/device';
import type { SessionController } from '../../lib/session-controller';
import { clipTime, type CameraFacing, type TimelapseRecorder } from '../../lib/timelapse';
import { TaskContext } from './TaskContext';
import { TimerDisplay } from './TimerDisplay';

/** How the camera shows on the camera screen: the whole picture, or a small circle. */
export type CameraView = 'full' | 'mini';

export interface PhoneCameraProps {
  ctl: SessionController;
  /** The phase line, as the focus screen words it. */
  phase: string;
  context: FocusContext;
  /** The clock and task are put away (H, or the eye button). */
  hidden: boolean;
  chromeVisible: boolean;
  recorder: TimelapseRecorder;
  /** Stills are being taken right now. */
  filming: boolean;
  /** Which camera is filming, so the front one shows as a mirror. */
  facing: CameraFacing;
  /** Swap cameras; absent when there is only one. */
  onFlip?: () => void;
  /** Stop the timelapse and go back to the focus screen, keeping the stills. */
  onStopRecording: () => void;
  /** The whole picture, or the camera tucked into a small circle. */
  view: CameraView;
  onViewChange: (view: CameraView) => void;
}

/** A live picture of the camera, in whatever element is given; the front camera mirrored by CSS. */
function useStreamIn(ref: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) {
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  });
}

/**
 * On a phone, the focus screen is the camera: the live picture across the whole screen, the
 * timer and task on it, and the session's controls along the bottom (down the side when the
 * phone is sideways; the page turns with the phone). The picture dims a little while focus
 * runs and comes back up for breaks and pauses. Breaks always show here; whether they are
 * filmed is the phone preset's "Record breaks too". The dimming is only on the screen, never
 * in the stills.
 *
 * The picture can also be tucked away into a small live circle beside the pause button, for
 * when the camera shouldn't be the thing on screen. That only covers the picture: the camera
 * keeps filming (the stills come from the recorder's own player, not this one), and the
 * circle opens it again at once.
 */
export function PhoneCamera({
  ctl,
  phase,
  context,
  hidden,
  chromeVisible,
  recorder,
  filming,
  facing,
  onFlip,
  onStopRecording,
  view,
  onViewChange,
}: PhoneCameraProps) {
  const { toast } = useToast();
  const { timer } = ctl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbRef = useRef<HTMLVideoElement>(null);
  useStreamIn(videoRef, recorder.stream);
  useStreamIn(thumbRef, view === 'mini' ? recorder.stream : null);
  // The picture fades in once the camera sends its first frame, rather than popping in over
  // the black of a camera still starting.
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (!recorder.stream) setShowing(false);
  }, [recorder.stream]);

  const onBreak = timer.phase === 'short-break' || timer.phase === 'long-break';
  const stopped = recorder.status === 'ended';
  const mini = view === 'mini';

  // The camera stopped while the page was away (the screen locked): start it again on return.
  const recorderRef = useRef(recorder);
  useEffect(() => {
    recorderRef.current = recorder;
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && recorderRef.current.status === 'ended')
        recorderRef.current.restartCamera();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Turning the phone after the video started: the video keeps its first shape. Said once.
  const toldTurn = useRef(false);
  useEffect(() => {
    const media = window.matchMedia?.('(orientation: portrait)');
    if (!media) return;
    const onTurn = () => {
      const firstStill = recorderRef.current.stills()[0];
      if (!firstStill || toldTurn.current) return;
      if ((firstStill.portrait ?? true) !== isUpright()) {
        toldTurn.current = true;
        toast(
          firstStill.portrait
            ? 'The video stays upright, the way it started.'
            : 'The video stays sideways, the way it started.',
        );
      }
    };
    media.addEventListener('change', onTurn);
    return () => media.removeEventListener('change', onTurn);
  }, [toast]);

  const { clip } = recorder;
  const status =
    recorder.status === 'starting'
      ? 'Starting the camera'
      : stopped
        ? 'The camera stopped'
        : recorder.cameraMuted
          ? 'The camera is paused'
          : clip
            ? `Live clip ${clipTime(clip)}`
            : filming
              ? 'Recording'
              : onBreak
                ? 'Not filming the break'
                : timer.phase === 'paused'
                  ? 'Paused'
                  : 'Waiting for focus';
  const clipButton = !!clip || recorder.canClip || recorder.clipsFull;

  const chrome = `focus-chrome${chromeVisible ? '' : ' is-hidden'}`;

  return (
    <div className={`pcam${mini ? ' is-mini' : ''}`} data-facing={facing}>
      <video
        ref={videoRef}
        className={`pcam-video${showing ? ' is-showing' : ''}`}
        autoPlay
        muted
        playsInline
        aria-hidden
        onPlaying={() => setShowing(true)}
      />
      <div className={`pcam-dim${timer.phase === 'work' ? ' is-on' : ''}`} aria-hidden />
      {/* Covers the picture in the small view; the video underneath keeps playing. */}
      <div className="pcam-cover" aria-hidden />

      <div className="pcam-top">
        <span className="pcam-rec" role="status">
          <span
            className={`timelapse-dot${filming && recorder.live ? '' : ' is-idle'}`}
            aria-hidden
          />
          <span className="pcam-rec-text">{status}</span>
        </span>
        <span className={`pcam-top-actions ${chrome}`}>
          <button
            type="button"
            className="pcam-round"
            aria-label={hidden ? 'Show the clock and task' : 'Hide the clock and task'}
            onClick={() => void ctl.toggleTimerVisibility()}
          >
            {hidden ? <Eye size={20} aria-hidden /> : <EyeOff size={20} aria-hidden />}
          </button>
          {onFlip && (
            <button
              type="button"
              className="pcam-round"
              aria-label={facing === 'user' ? 'Use the back camera' : 'Use the front camera'}
              onClick={onFlip}
            >
              <SwitchCamera size={20} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="pcam-round"
            aria-label="Stop recording"
            onClick={onStopRecording}
          >
            <VideoOff size={20} aria-hidden />
          </button>
        </span>
      </div>

      {stopped && (
        <button type="button" className="pcam-restart" onClick={recorder.restartCamera}>
          The camera stopped when the screen went off. Tap to start it again.
        </button>
      )}

      <div className={`pcam-info${hidden ? ' is-bare' : ''}`}>
        <div className="focus-phase">{phase}</div>
        {!hidden && (
          <>
            <TimerDisplay
              digits={ctl.digits}
              meaning={timer.mode === 'unlimited' ? 'elapsed' : 'remaining'}
            />
            <TaskContext subject={context.subject} child={context.child} />
          </>
        )}
      </div>

      <div className={`pcam-dock ${chrome}`}>
        {(clipButton || ctl.canSkip || (timer.mode === 'scheduled' && timer.plannedEndAt)) && (
          <div className="pcam-extra">
            {clipButton && (
              <button
                type="button"
                className={`pcam-pill${clip ? ' is-clip' : ''}`}
                onClick={recorder.toggleClip}
                disabled={!clip && recorder.clipsFull}
              >
                {clip ? (
                  <>
                    <Square size={13} aria-hidden /> Stop clip
                  </>
                ) : (
                  <>
                    <Clapperboard size={15} aria-hidden />{' '}
                    {recorder.clipsFull ? 'Live clips used up' : 'Live clip'}
                  </>
                )}
              </button>
            )}
            {ctl.canSkip && (
              <button
                type="button"
                className="pcam-pill"
                onClick={() => void ctl.send({ type: 'skip-break' })}
              >
                <SkipForward size={15} aria-hidden /> Skip break
              </button>
            )}
            {timer.mode === 'scheduled' && timer.plannedEndAt && (
              <button type="button" className="pcam-pill" onClick={() => void ctl.extend(15)}>
                +15 min
              </button>
            )}
          </div>
        )}
        <div className="pcam-controls">
          {/* Where the Camera app keeps its last photo: the camera, small or whole. */}
          {mini ? (
            <button
              type="button"
              className="pcam-thumb"
              aria-label="Show the camera"
              onClick={() => onViewChange('full')}
            >
              <video ref={thumbRef} autoPlay muted playsInline aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="pcam-round"
              aria-label="Make the camera small"
              onClick={() => onViewChange('mini')}
            >
              <PictureInPicture2 size={20} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="pcam-shutter"
            aria-label={ctl.canResume ? 'Resume' : 'Pause'}
            disabled={ctl.busy || (!ctl.canPause && !ctl.canResume)}
            onClick={() => void ctl.send({ type: ctl.canResume ? 'resume' : 'pause' })}
          >
            {ctl.canResume ? <Play size={26} aria-hidden /> : <Pause size={26} aria-hidden />}
          </button>
          <button
            type="button"
            className="pcam-round is-stop"
            aria-label="Stop the session"
            onClick={() => void ctl.stop()}
            disabled={ctl.busy}
          >
            <Square size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
