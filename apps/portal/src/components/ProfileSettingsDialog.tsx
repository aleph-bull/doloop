import { useEffect, useRef, useState } from 'react';
import { displayNameError } from '@komogon/core';
import { Button, Modal, useToast } from '@komogon/ui';
import type { PublicProfile } from '../lib/api';
import { useMe, useUpdateSettings } from '../lib/queries';
import { ProfileFields } from './ProfileFields';

export interface ProfileSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  profile: PublicProfile;
}

/**
 * The gear on your own profile: the same fields as Settings › Account. The picture and the
 * university apply as soon as they are chosen or confirmed; the name and the line about you
 * save together on Save.
 */
export function ProfileSettingsDialog({ open, onClose, profile }: ProfileSettingsDialogProps) {
  const update = useUpdateSettings();
  const me = useMe();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');

  // Start from what the profile shows each time it opens, so a cancelled edit leaves no trace.
  // Only on opening: the picture and university fields refetch the profile while the dialog
  // is up, and that must not wipe a name or bio typed but not yet saved.
  // The name comes from your account, not the profile: with no name of your own, the profile
  // shows your username (or "Someone") in its place.
  const latest = useRef({ profile, name: me.data?.user.settings.profile.name ?? '' });
  useEffect(() => {
    latest.current = { profile, name: me.data?.user.settings.profile.name ?? '' };
  }, [profile, me.data]);
  useEffect(() => {
    if (!open) return;
    const { profile: p, name: own } = latest.current;
    setName(own.trim());
    setBio(p.bio ?? '');
  }, [open]);

  const save = async () => {
    if (displayNameError(name)) return;
    try {
      await update.mutateAsync({
        profile: { name: name.trim() || null, bio: bio.trim() || null },
      });
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <Modal
      phone="full"
      open={open}
      onClose={onClose}
      title="Your profile"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={update.isPending}
            disabled={!!displayNameError(name)}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ProfileFields
          active={open}
          avatarUrl={profile.avatarUrl}
          name={name}
          onNameChange={setName}
          bio={bio}
          onBioChange={setBio}
        />
      </form>
    </Modal>
  );
}
