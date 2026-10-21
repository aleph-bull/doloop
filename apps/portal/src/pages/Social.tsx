import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Users } from 'lucide-react';
import { Button, Glass, Input, Spinner, Toggle } from '@komogon/ui';
import { api } from '../lib/api';
import { LocalMailInbox } from '../components/LocalMailInbox';
import { ErrorPanel } from '../components/ErrorState';

export function Social() {
  const me = useQuery({ queryKey: ['social', 'me'], queryFn: api.socialMe });
  if (me.isError)
    return <ErrorPanel message="Could not load your profile." onRetry={() => void me.refetch()} />;
  if (!me.data) return <Spinner />;
  return <SocialContent data={me.data} />;
}

function SocialContent({ data }: { data: Awaited<ReturnType<typeof api.socialMe>> }) {
  const qc = useQueryClient();
  const profile = data.profile;
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [organizationName, setOrganizationName] = useState(profile.organizationName);
  const [visible, setVisible] = useState(profile.visible);
  const [email, setEmail] = useState(profile.organizationEmail ?? '');
  const [challenge, setChallenge] = useState<string | null>(null),
    [code, setCode] = useState('');
  const [accountChallenge, setAccountChallenge] = useState<string | null>(null),
    [accountCode, setAccountCode] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ['social', 'people'],
    queryFn: api.socialPeople,
    refetchInterval: 60_000,
  });
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await qc.invalidateQueries({ queryKey: ['social'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="social-page flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Social</h1>
          <p className="greeting-line">Your profile and people at your school or organization.</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="social-profile-grid">
        <Glass className="p-6 flex flex-col gap-5" strong>
          <h2 className="section-title">Your profile</h2>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.updateSocial({ displayName, organizationName, visible });
                setNotice('Profile saved.');
              });
            }}
          >
            <Input
              label="Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              required
            />
            <Input
              label="School or organization"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              maxLength={100}
              placeholder="e.g. University of Toronto"
            />
            <Toggle
              checked={visible && !!profile.organizationVerifiedAt}
              onChange={setVisible}
              disabled={!profile.organizationVerifiedAt || busy}
              label="Show my profile to people at my organization"
              description="Share your name and organization with people who verified the same email domain. Your email address and study records stay private."
            />
            <Button type="submit" variant="primary" loading={busy}>
              Save profile
            </Button>
          </form>
        </Glass>
        <Glass className="p-6 flex flex-col gap-5" strong>
          <h2 className="section-title">Verify your school or organization email</h2>
          <p className="muted text-sm">
            Use a school or work address. Your sign-in email and Google Calendar connection stay the
            same.
          </p>
          {profile.organizationVerifiedAt && (
            <div className="social-verified">
              <BadgeCheck size={20} aria-hidden />
              <div>
                <strong>{profile.organizationDomain} email verified</strong>
                <p className="muted text-sm">{profile.organizationEmail}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.unlinkOrganization();
                    setVisible(false);
                    setChallenge(null);
                  })
                }
              >
                Remove
              </Button>
            </div>
          )}
          {!profile.organizationVerifiedAt && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (challenge) {
                    await api.verifyOrganization(challenge, code);
                    setChallenge(null);
                    setVisible(false);
                    setNotice('Organization email verified. You can choose to share your profile.');
                  } else setChallenge((await api.requestOrganizationCode(email)).challengeId);
                });
              }}
            >
              {!challenge ? (
                <Input
                  label="School or organization email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              ) : (
                <>
                  <p className="muted text-sm">Enter the code sent to {email}.</p>
                  <Input
                    label="Organization verification code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </>
              )}
              <Button type="submit" loading={busy} disabled={!data.mailAvailable}>
                {challenge ? 'Verify organization email' : 'Send verification code'}
              </Button>
              {challenge && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setChallenge((await api.requestOrganizationCode(email)).challengeId),
                      )
                    }
                  >
                    Resend code
                  </Button>
                  <LocalMailInbox email={email} />
                </>
              )}
            </form>
          )}
          {!data.mailAvailable && (
            <p className="field-hint">Email delivery has not been configured yet.</p>
          )}
          <p className="field-hint">
            The badge confirms access to that email domain. It does not confirm a role or position.
          </p>
        </Glass>
      </div>
      {!data.emailVerified && (
        <Glass className="p-6 flex flex-col gap-4">
          <h2 className="section-title">Verify your sign-in email</h2>
          <p className="muted text-sm">{data.accountEmail}</p>
          {!accountChallenge ? (
            <Button
              disabled={busy || !data.mailAvailable}
              onClick={() =>
                void run(async () =>
                  setAccountChallenge((await api.requestAccountCode()).challengeId),
                )
              }
            >
              Send account verification code
            </Button>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.verifyAccountCode(accountChallenge, accountCode);
                  setAccountChallenge(null);
                  setNotice('Sign-in email verified.');
                });
              }}
            >
              <Input
                label="Account verification code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                required
              />
              <Button type="submit" loading={busy}>
                Verify sign-in email
              </Button>
              <LocalMailInbox email={data.accountEmail} />
            </form>
          )}
        </Glass>
      )}
      <Glass className="p-6 flex flex-col gap-5">
        <h2 className="section-title">
          {profile.organizationDomain
            ? `People at ${profile.organizationDomain}`
            : 'People at your organization'}
        </h2>
        {!profile.organizationVerifiedAt ? (
          <div className="social-empty">
            <Building2 size={24} aria-hidden />
            <p>
              Verify your school or organization email to see profiles from the same email domain.
            </p>
          </div>
        ) : people.isError ? (
          <ErrorPanel message="Could not load people." onRetry={() => void people.refetch()} />
        ) : people.isPending ? (
          <Spinner />
        ) : !people.data?.people.length ? (
          <div className="social-empty">
            <Users size={24} aria-hidden />
            <p>
              No shared profiles here yet. Profiles appear when people from this domain choose to
              share them.
            </p>
          </div>
        ) : (
          <div className="social-people">
            {people.data.people.map((person) => (
              <article key={person.id} className="social-person">
                <span className="social-avatar" aria-hidden>
                  {person.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <h3>{person.displayName}</h3>
                  <p className="muted text-sm">
                    {person.organizationName || person.organizationDomain}
                  </p>
                  <span className="field-hint">{person.organizationDomain} email verified</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </Glass>
    </div>
  );
}
