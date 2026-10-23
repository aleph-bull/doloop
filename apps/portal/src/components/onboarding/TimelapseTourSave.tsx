import { Button } from '@komogon/ui';
import type { LayoutEditorControls } from '../focus/TimelapseLayoutEditor';
import { useMe } from '../../lib/queries';
import { saveAnswers, setTour } from '../../lib/tour';

/**
 * Under the timelapse editor while the first-time setup is on its timelapse part, in place
 * of the unsaved-changes bubble: Save, which also ends that part (`Tour.tsx` takes over).
 */
export function TimelapseTourSave({ dirty, saving, save }: LayoutEditorControls) {
  const userId = useMe().data?.user.id ?? '';
  return (
    <div className="tour-tl-save">
      <Button
        variant="primary"
        loading={saving}
        onClick={async () => {
          if (dirty) await save();
          saveAnswers({ sections: { timelapse: 'done' } });
          setTour(userId, { stage: 'finish' });
        }}
      >
        Save
      </Button>
    </div>
  );
}
