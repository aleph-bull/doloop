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
          The visualizer needs to hear your music. Share a tab, window or your screen, and tick{' '}
          <strong>share audio</strong> in the browser&rsquo;s picker. We don&rsquo;t record
          anything, and it&rsquo;s optional.
        </p>
      </div>
    </Modal>
  );
}
