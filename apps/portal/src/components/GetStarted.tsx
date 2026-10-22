import { CalendarDays, ChevronRight, ClipboardPaste, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
  const [paste, setPaste] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const refreshFeeds = useRefreshFeeds();
  const { toast } = useToast();

  return (
    <Glass className="get-started">
      <div className="get-started-head">
        <h2 className="section-title">{title}</h2>
        <p className="muted">{line}</p>
      </div>
      <div className="get-started-options">
        <Option
          icon={<ClipboardPaste size={18} aria-hidden />}
          title="Paste from an AI chat"
          sub="Give ChatGPT or Claude your course outlines, then paste back its list."
          onClick={() => setPaste(true)}
        />
        <Option
          icon={<CalendarDays size={18} aria-hidden />}
          title="Add your calendar"
          sub="Paste its .ics link, and exams and deadlines become tasks."
          onClick={() => setCalendar(true)}
        />
        <Option
          icon={<Plus size={18} aria-hidden />}
          title="Add them yourself"
          sub="One course at a time."
          to="/tasks"
        />
      </div>
      <PasteListDialog open={paste} onClose={() => setPaste(false)} onAdded={onAdded} />
      {calendar && (
        <AddCalendarDialog
          onClose={() => setCalendar(false)}
          onAdded={(r) => {
            setCalendar(false);
            refreshFeeds();
            toast(feedAddedMessage(r), { tone: 'ok' });
            onAdded?.();
          }}
        />
      )}
    </Glass>
  );
}

function Option({
  icon,
  title,
  sub,
  to,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  to?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="get-started-icon">{icon}</span>
      <span className="get-started-text">
        <span className="get-started-title">{title}</span>
        <span className="get-started-sub">{sub}</span>
      </span>
      <ChevronRight size={16} className="get-started-chevron" aria-hidden />
    </>
  );
  return to ? (
    <Link to={to} className="get-started-option">
      {body}
    </Link>
  ) : (
    <button type="button" className="get-started-option" onClick={onClick}>
      {body}
    </button>
  );
}
