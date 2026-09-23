import type { FocusContext } from '@doloop/core';

/** "Financial Accounting / for Adjusting Entries", from the real task tree. */
export function TaskContext({ subject, child }: FocusContext) {
  return (
    <div className="focus-context">
      <div className="focus-subject">{subject}</div>
      {child && (
        <div className="focus-child">
          <span className="focus-for">for </span>
          {child}
        </div>
      )}
    </div>
  );
}
