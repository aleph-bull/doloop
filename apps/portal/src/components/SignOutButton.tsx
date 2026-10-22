import { Button, Modal } from '@komogon/ui';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useMe } from '../lib/queries';

/**
 * Sign out, as the top bar's icon, a row of the sidebar, or a labelled button in Settings.
 * It asks first: the icon sits beside Settings, so it is easy to hit by mistake, and signing
 * out also clears the offline copy in this browser.
 */
export function SignOutButton({
  labelled = false,
  rail = false,
}: {
  labelled?: boolean;
  /** A row of the sidebar: the icon always, the label once the sidebar opens. */
  rail?: boolean;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  // A dev account can't be signed back into: the next dev sign-in makes a new one.
  const dev = useMe().data?.user.devAccount === true;
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    try {
      await auth.signOut();
      navigate('/signin');
    } finally {
      setLeaving(false);
      setAsking(false);
    }
  };

  return (
    <>
      {rail ? (
        <button
          type="button"
          className="sidenav-link"
          title="Sign out"
          onClick={() => setAsking(true)}
        >
          <span className="sidenav-icon" aria-hidden>
            <LogOut size={19} strokeWidth={1.9} />
          </span>
          <span className="sidenav-label">Sign out</span>
        </button>
      ) : labelled ? (
        <Button variant="secondary" size="sm" title="Sign out" onClick={() => setAsking(true)}>
          {/* Its own element, so a narrow place (the profile on a phone) can show the icon only. */}
          <LogOut size={15} aria-hidden /> <span className="signout-label">Sign out</span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon
          className="nav-signout"
          aria-label="Sign out"
          title="Sign out"
          onClick={() => setAsking(true)}
        >
          <LogOut size={16} aria-hidden />
        </Button>
      )}
      <Modal
        open={asking}
        onClose={() => !leaving && setAsking(false)}
        title="Sign out?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={leaving}>
              Stay signed in
            </Button>
            <Button onClick={signOut} loading={leaving}>
              Sign out
            </Button>
          </>
        }
      >
        <p>
          {dev
            ? "This is a dev account, so you won't get back into it. The next dev sign-in starts a fresh one."
            : 'You can sign back in any time. Your data stays in your account; only the copy kept in this browser is cleared.'}
        </p>
      </Modal>
    </>
  );
}
