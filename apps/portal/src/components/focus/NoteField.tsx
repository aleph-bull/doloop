import { cleanNoteText, TIMELAPSE_NOTE_MAX } from '@komogon/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@komogon/ui';

/** What the field says under itself, here and in "Change layout?". */
export const NOTE_HINT =
  'Stays on the video the whole way through, like the clocks. Move it in the layout. Leave it empty and it’s left out.';

/**
 * The person's own line of text on the video. Saved a moment after typing stops, and on
 * leaving the field; empty, the text is left off the video.
 */
export function NoteField({
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
      const clean = cleanNoteText(next);
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
      label="Text on the video"
      value={text}
      maxLength={TIMELAPSE_NOTE_MAX}
      placeholder="Week 3 of finals"
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
      hint={NOTE_HINT}
    />
  );
}
