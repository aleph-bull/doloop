import { Button, Modal } from '@komogon/ui';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';

/**
 * The nav's sign-out button. It asks first: the button sits beside Settings, so it is easy
 * to hit by mistake, and signing out also clears the offline copy in this browser.
 */
export function SignOutButton() {
  const auth = useAuth();
  const navigate = useNavigate();
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
          You can sign back in any time. Your data stays in your account; only the copy kept in
          this browser is cleared.
        </p>
      </Modal>
    </>
  );
}
