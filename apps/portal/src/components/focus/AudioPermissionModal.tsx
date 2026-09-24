import { Button, Modal } from '@komogon/ui';

export interface AudioPermissionModalProps {
  open: boolean;
  /** True when the visualizer is already on and only the audio share is being asked for. */
  alreadyEnabled: boolean;
  /** Enable the visualizer and start the browser's share prompt. Runs on the click itself. */
  onYes: () => void;
  onNo: () => void;
  onNever: () => void;
}

/**
 * Says exactly what sharing means before the browser's own picker appears. The picker is
 * the browser's, and the user chooses what to share in it; this only explains why.
 */
export function AudioPermissionModal({
  open,
  alreadyEnabled,
  onYes,
  onNo,
  onNever,
}: AudioPermissionModalProps) {
  return (
    <Modal
      open={open}
      onClose={onNo}
      title={
        alreadyEnabled ? 'Let the visualizer hear your music?' : 'Enable the audio visualizer?'
      }
      actions={
        <>
          <Button variant="ghost" onClick={onNever}>
            Never ask again
          </Button>
          <Button onClick={onNo}>No</Button>
          <Button variant="primary" onClick={onYes}>
            Yes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="muted">
          To react to your music, the visualizer needs audio from a screen, window or tab you choose
          to share. The browser will ask you to pick one:
        </p>
        <ul className="list-disc pl-5 muted flex flex-col gap-1">
          <li>this tab, or another browser tab</li>
          <li>a window, such as a music player</li>
          <li>your whole screen</li>
        </ul>
        <p className="muted">
          Tick <strong>share audio</strong> in that picker. Your audio is analysed on this device
          only, never recorded or sent anywhere, and you can stop sharing at any time. Without a
          share the visualizer simply idles.
        </p>
      </div>
    </Modal>
  );
}
