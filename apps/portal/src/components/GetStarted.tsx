import { CalendarDays, Check, ChevronRight, ClipboardPaste, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { Glass, useToast } from '@komogon/ui';
import { AddCalendarDialog, feedAddedMessage, useRefreshFeeds } from './CalendarFeedsSettings';
import { PasteListDialog } from './PasteListDialog';

export interface GetStartedProps {
  title: string;
  line: string;
  /** Called once a pasted list or a calendar has been added. */
  onAdded?: () => void;
}

/**
 * The quick ways in for someone with nothing in Tasks yet: a whole term pasted from an AI
 * chat, a calendar that already has the deadlines (by its .ics link, which needs no setup
 * on the server), or one course at a time. All of them can wait; a session never needs any
 * of this first.
 */
export function GetStarted({ title, line, onAdded }: GetStartedProps) {
  return (
    <Glass className="get-started">
      <div className="get-started-head">
        <h2 className="section-title">{title}</h2>
        <p className="muted">{line}</p>
      </div>
      <GetStartedOptions onAdded={onAdded} />
    </Glass>
  );
}

export interface GetStartedOptionsProps {
  /** Called once a pasted list or a calendar has been added. */
  onAdded?: () => void;
  /** A calendar came in already (during setup): its option is greyed out. */
  calendarAdded?: boolean;
  /** Whether the paste or calendar dialog is open, for a dialog that holds these options. */
  onDialog?: (open: boolean) => void;
  /** Picked "Add them yourself", just before it goes to Tasks. */
  onManual?: () => void;
}

/** The three options on their own, for the card above and the end of the first-time setup. */
export function GetStartedOptions({
  onAdded,
  calendarAdded = false,
  onDialog,
  onManual,
}: GetStartedOptionsProps) {
  const [paste, setPaste] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const refreshFeeds = useRefreshFeeds();
  const { toast } = useToast();
  const openPaste = (open: boolean) => {
    setPaste(open);
    onDialog?.(open);
  };
  const openCalendar = (open: boolean) => {
    setCalendar(open);
    onDialog?.(open);
  };

  return (
    <>
      <div className="get-started-options">
        <Option
          icon={<ClipboardPaste size={18} aria-hidden />}
          title="Paste from an AI chat"
          sub="Give ChatGPT or Claude your course outlines, then paste back its list"
          onClick={() => openPaste(true)}
        />
        <Option
          icon={
            calendarAdded ? <Check size={18} aria-hidden /> : <CalendarDays size={18} aria-hidden />
          }
          title="Add your calendar"
          sub={
            calendarAdded ? 'Added' : 'Paste its .ics link, and exams and deadlines become tasks'
          }
          disabled={calendarAdded}
          onClick={() => openCalendar(true)}
        />
        <Option
          icon={<Plus size={18} aria-hidden />}
          title="Add them yourself"
          sub="One course at a time"
          to="/tasks"
          onClick={onManual}
        />
      </div>
      {/* Out at the page's root, so they still open when these options sit in a dialog
          that steps aside for them. */}
      {createPortal(
        <>
          <PasteListDialog open={paste} onClose={() => openPaste(false)} onAdded={onAdded} />
          {calendar && (
            <AddCalendarDialog
              onClose={() => openCalendar(false)}
              onAdded={(r) => {
                openCalendar(false);
                refreshFeeds();
                toast(feedAddedMessage(r), { tone: 'ok' });
                onAdded?.();
              }}
            />
          )}
        </>,
        document.body,
      )}
    </>
  );
}

function Option({
  icon,
  title,
  sub,
  to,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="get-started-icon">{icon}</span>
      <span className="get-started-text">
        <span className="get-started-title">{title}</span>
        <span className="get-started-sub">{sub}</span>
      </span>
      {!disabled && <ChevronRight size={16} className="get-started-chevron" aria-hidden />}
    </>
  );
  return to ? (
    <Link to={to} className="get-started-option" onClick={onClick}>
      {body}
    </Link>
  ) : (
    <button type="button" className="get-started-option" onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}
