import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ImagePlus } from 'lucide-react';
import {
  DISPLAY_NAME_MAX,
  displayNameError,
  normalizeUsername,
  usernameError,
  usernameUnlocksAt,
} from '@komogon/core';
import { Button, Input, Textarea, useToast } from '@komogon/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { keys, useMe, useSetUsername, useUniversityStatus } from '../lib/queries';
import { Avatar } from '../pages/Profile';
import { UsernameInput } from './UsernameInput';

export const BIO_MAX = 280;
/** The picture is shown at 88px at most; this leaves room for sharp screens. */
const AVATAR_EDGE = 256;

const say = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Crop to a square from the middle, shrink, and encode as JPEG. */
async function prepareAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const edge = Math.min(AVATAR_EDGE, side);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    edge,
    edge,
  );
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** The profile picture: choose, change or remove. Saves as soon as a file is picked. */
function PictureField({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['profiles'] });
    await qc.invalidateQueries({ queryKey: keys.avatar });
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadAvatar(await prepareAvatar(file));
      await refresh();
    } catch (err) {
      toast(say(err, 'Could not save the picture'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteAvatar();
      await refresh();
    } catch (err) {
      toast(say(err, 'Could not remove the picture'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span className="field-label">Picture</span>
      <div className="profile-dialog-avatar">
        <Avatar name={name} url={avatarUrl} />
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" loading={busy} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={15} aria-hidden />
            {avatarUrl ? 'Change picture' : 'Choose a picture'}
          </Button>
          {avatarUrl && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Choose a profile picture"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </div>
      <span className="field-hint">A JPEG, PNG or WebP. It is cropped to a square.</span>
    </div>
  );
}

/**
 * The university field. It is never typed in: the person gives an address on their
 * university's domain, a code goes there, and the university appears once the code comes
 * back. Three states: verified, a code on its way, or nothing yet.
 */
function UniversityField({ active }: { active: boolean }) {
  const status = useUniversityStatus(active);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Hidden while the pending code is used, so "use a different address" can show the form again.
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!active) return;
    setEmail('');
    setCode('');
    setChanging(false);
  }, [active]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: keys.university });
    await qc.invalidateQueries({ queryKey: ['profiles'] });
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  const run = async (fn: () => Promise<unknown>, fallback: string, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (ok) toast(ok, { tone: 'ok' });
      return true;
    } catch (err) {
      toast(say(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const addr = email.trim();
    if (!addr) return;
    if (await run(() => api.sendUniversityCode(addr), 'Could not send the code')) {
      setCode('');
      setChanging(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) return;
    if (
      await run(
        () => api.confirmUniversityCode(code.trim()),
        'Could not check the code',
        'Your university is on your profile now.',
      )
    )
      setCode('');
  };

  const remove = () =>
    run(() => api.removeUniversity(), 'Could not remove it', 'Taken off your profile.');

  const s = status.data;
  if (!s) return null;

  if (s.university)
    return (
      <div className="field">
        <span className="field-label">University</span>
        <div className="profile-uni-row">
          <span className="profile-uni-name">
            <BadgeCheck size={16} aria-hidden className="profile-verified" />
            {s.university.name}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
            Remove
          </Button>
        </div>
        <span className="field-hint">
          {s.email ? `Verified with ${s.email}. ` : ''}The address stays private; only the
          university shows.
        </span>
      </div>
    );

  if (s.pending && !changing)
    return (
      <div className="field">
        <label className="field-label" htmlFor="uni-code">
          Code from your email
        </label>
        <div className="profile-uni-row">
          <Input
            id="uni-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="6 digits"
            className="profile-uni-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void confirm();
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={code.trim().length !== 6}
            onClick={() => void confirm()}
          >
            Confirm
          </Button>
        </div>
        <span className="field-hint">
          We sent a code to {s.pending.email} for {s.pending.university.name}. It works for 15
          minutes.{' '}
          <button type="button" className="link-button" onClick={() => setChanging(true)}>
            Send a new one, or use a different address
          </button>
        </span>
      </div>
    );

  return (
    <div className="field">
      <label className="field-label" htmlFor="uni-email">
        University email
      </label>
      <div className="profile-uni-row">
        <Input
          id="uni-email"
          type="email"
          autoComplete="email"
          placeholder="john@university.ca"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button size="sm" loading={busy} disabled={!email.trim()} onClick={() => void send()}>
          Send code
        </Button>
      </div>
      <span className="field-hint">
        The address your Ontario university gave you. We send a code there to confirm it, and the
        profile shows only the university, never the address.
      </span>
    </div>
  );
}

/**
 * The username, with its @ drawn in front. It saves on its own button, never on blur: a
 * chosen one holds for two weeks, so a half-typed name must not be kept by accident. The one
 * the app picked can be swapped at once. `/settings#username` focuses it.
 */
function UsernameField() {
  const me = useMe();
  const set = useSetUsername();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const user = me.data?.user;
  if (!user) return null;

  const current = user.username ?? '';
  const value = draft ?? current;
  const changed = normalizeUsername(value) !== current;
  const problem = refused ?? (changed ? usernameError(value) : null);
  const until = usernameUnlocksAt(user.usernameChangedAt, new Date().toISOString());

  const save = async () => {
    if (!changed || problem || until) return;
    try {
      await set.mutateAsync(value);
      setDraft(null);
      toast('Username saved.');
    } catch (err) {
      setRefused(say(err, 'Could not save it'));
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor="username">
        Username
      </label>
      <div className="profile-uni-row">
        <UsernameInput
          id="username"
          disabled={!!until}
          autoFocus={window.location.hash === '#username'}
          aria-invalid={!!problem}
          value={value}
          onChange={(next) => {
            setDraft(next);
            setRefused(null);
          }}
          onEnter={() => void save()}
        />
        <Button
          size="sm"
          variant="primary"
          loading={set.isPending}
          disabled={!changed || !!problem || !!until}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      {problem ? (
        <span className="field-hint field-error">{problem}</span>
      ) : (
        until && <span className="field-hint">Can change again {fmtDate(until)}</span>
      )}
    </div>
  );
}

export interface ProfileFieldsProps {
  avatarUrl: string | null;
  name: string;
  onNameChange: (name: string) => void;
  bio: string;
  onBioChange: (bio: string) => void;
  /** Called when the name or the line about you loses focus, for a form that saves per field. */
  onCommit?: () => void;
  /** Whether the fields are showing (a closed dialog doesn't load the university status). */
  active?: boolean;
}

/**
 * Everything on a profile that can be changed, in one place: the picture, the display name,
 * the username, the university and a line about you. Used by the gear dialog on the profile
 * and by Settings › Account. The picture, the username and the university save themselves;
 * the display name and the line are the caller's to save (on a button, or on blur through
 * `onCommit`), and only when `displayNameError` has nothing to say.
 */
export function ProfileFields({
  avatarUrl,
  name,
  onNameChange,
  bio,
  onBioChange,
  onCommit,
  active = true,
}: ProfileFieldsProps) {
  const nameProblem = displayNameError(name);
  return (
    <>
      <PictureField avatarUrl={avatarUrl} name={name} />
      <Input
        label="Display name"
        hint={
          nameProblem ? (
            <span className="field-error">{nameProblem}</span>
          ) : (
            'Shown on your profile and the leaderboard, and used to say hello.'
          )
        }
        placeholder="e.g. John"
        maxLength={DISPLAY_NAME_MAX}
        aria-invalid={!!nameProblem}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onBlur={onCommit}
      />
      <UsernameField />
      <UniversityField active={active} />
      <Textarea
        label="About you"
        hint={`${BIO_MAX - bio.length} characters left.`}
        placeholder="What you study, or what you are working toward."
        rows={3}
        maxLength={BIO_MAX}
        value={bio}
        onChange={(e) => onBioChange(e.target.value)}
        onBlur={onCommit}
      />
    </>
  );
}
