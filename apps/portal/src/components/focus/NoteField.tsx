import { TIMELAPSE_NOTE_MAX } from '@komogon/core';
import { Input } from '@komogon/ui';

/**
 * The person's own line of text on the video, written after the session: on the "Your
 * timelapse" card once the recording has stopped, and in "Change layout?". It belongs to that
 * one video, so the next one starts empty; empty, the text is left off the video.
 */
export function NoteField({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <Input
      label="Text on the video"
      value={value}
      maxLength={TIMELAPSE_NOTE_MAX}
      placeholder="Week 3 of finals"
      onChange={(e) => onChange(e.target.value)}
      hint="Stays on the video the whole way through, like the clocks. Move it in the layout. Leave it empty and it’s left out."
    />
  );
}
