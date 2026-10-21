import { useEffect, useState } from 'react';
import { Button, Modal, useToast } from '@komogon/ui';
import type { PublicProfile } from '../lib/api';
import { useUpdateSettings } from '../lib/queries';
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
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');

  // Start from what the profile shows each time it opens, so a cancelled edit leaves no trace.
  useEffect(() => {
    if (!open) return;
    setName(profile.name === 'Someone' ? '' : profile.name);
    setBio(profile.bio ?? '');
  }, [open, profile]);

  const save = async () => {
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
      open={open}
      onClose={onClose}
      title="Your profile"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={update.isPending}>
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
