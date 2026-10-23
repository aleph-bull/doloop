import type { UserSettings } from '@komogon/core';
import {
  accentHexFor,
  backgroundById,
  Button,
  Input,
  useToast,
  type ResolvedTheme,
} from '@komogon/ui';
import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import {
  deletePreset,
  loadPresets,
  MAX_PRESETS,
  presetImage,
  renamePreset,
  savePreset,
  type AppearancePreset,
} from '../lib/appearance-presets';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface AppearancePresetsProps {
  theme: UserSettings['theme'];
  resolved: ResolvedTheme;
  patch: (p: DeepPartial<UserSettings>) => Promise<unknown>;
  /** After a preset put an uploaded image back, so the backdrop reloads it. */
  onImageApplied: () => void;
}

const glossy = (panel: AppearancePreset['panel']) => panel === 'glass';

/** The preview's background: the photo or gradient, a solid colour, or the kept image. */
function previewStyle(
  p: AppearancePreset,
  image: string | null,
  resolved: ResolvedTheme,
): CSSProperties {
  if (p.hasImage && image)
    return {
      backgroundImage: `url("${image}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  const def = backgroundById(p.backgroundId);
  if (def.photo)
    return {
      backgroundImage: `url("/${def.photo.thumb}"), url("${def.photo.lqip}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  return { background: (resolved === 'dark' ? def.dark : def.light).css };
}

function PresetCard({
  preset,
  resolved,
  onApply,
  onRename,
  onDelete,
  busy,
}: {
  preset: AppearancePreset;
  resolved: ResolvedTheme;
  onApply: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(preset.name);
  useEffect(() => {
    if (!preset.hasImage) return;
    let live = true;
    void presetImage(preset.id).then((img) => live && setImage(img));
    return () => {
      live = false;
    };
  }, [preset.id, preset.hasImage]);

  const accent = accentHexFor(preset.accent);
  const isGlossy = glossy(preset.panel);
  return (
    <div className="preset">
      <button
        type="button"
        className="preset-preview"
        style={previewStyle(preset, image, resolved)}
        aria-label={`Use ${preset.name}`}
        disabled={busy}
        onClick={onApply}
      >
        {/* A little card in the preset's panel style, with its accent on it. */}
        <span
          className={`preset-panel${isGlossy ? ' is-glossy' : ' is-matte'}`}
          style={
            preset.panel === 'custom'
              ? { background: preset.panelColor, opacity: Math.max(0.6, preset.panelAlpha) }
              : undefined
          }
        >
          <span className="preset-accent" style={{ background: accent }} />
          <span className="preset-lines">
            <span />
            <span />
          </span>
        </span>
        {preset.hasImage && !image && <span className="preset-missing">Image not here</span>}
      </button>
      <div className="preset-foot">
        {editing ? (
          <form
            className="flex gap-1 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              onRename(name);
              setEditing(false);
            }}
          >
            <Input
              aria-label="Preset name"
              value={name}
              maxLength={40}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                onRename(name);
                setEditing(false);
              }}
            />
          </form>
        ) : (
          <>
            <span className="preset-name truncate">{preset.name}</span>
            <span className="preset-kind">{isGlossy ? 'Glossy' : 'Matte'}</span>
            <button
              type="button"
              className="preset-tool"
              aria-label={`Rename ${preset.name}`}
              onClick={() => setEditing(true)}
            >
              <Pencil size={12} aria-hidden />
            </button>
            <button
              type="button"
              className="preset-tool"
              aria-label={`Delete ${preset.name}`}
              onClick={onDelete}
            >
              <X size={13} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Saved looks: the background (including an uploaded image), accent and panel style, under
 * a name. Kept in this browser only. Picking one applies all of it. Shown as the Themes
 * picker's Custom tab, so it renders straight into that field, with no heading of its own.
 */
export function AppearancePresets({
  theme,
  resolved,
  patch,
  onImageApplied,
}: AppearancePresetsProps) {
  const { toast } = useToast();
  const [presets, setPresets] = useState<AppearancePreset[]>(() => loadPresets());
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      // An uploaded background is copied into this browser along with the preset.
      const image = theme.customBackgroundUrl ? (await api.getBackground()).dataUrl : null;
      await savePreset(name, theme, image);
      setPresets(loadPresets());
      setNaming(false);
      setName('');
      toast('Look saved', { tone: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the look');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (p: AppearancePreset) => {
    setBusy(true);
    try {
      const look = {
        accent: p.accent,
        panel: p.panel,
        panelColor: p.panelColor,
        panelAlpha: p.panelAlpha,
        // A look saved before the glass settings keeps whatever glass is set now.
        ...(p.glassBlur === undefined
          ? {}
          : {
              glassColor: p.glassColor ?? null,
              glassAlpha: p.glassAlpha ?? null,
              glassBlur: p.glassBlur,
              glassSaturate: p.glassSaturate ?? 100,
            }),
        ...(p.texture ? { texture: p.texture } : {}),
        ...(p.backgroundBlur === undefined
          ? {}
          : {
              backgroundBlur: p.backgroundBlur,
              backgroundBrightness: p.backgroundBrightness ?? 0,
            }),
      };
      if (p.hasImage) {
        const image = await presetImage(p.id);
        if (image) {
          await api.uploadBackground(image);
          await patch({ theme: look });
          onImageApplied();
        } else {
          // The image only ever lived in the browser it was saved in.
          await patch({ theme: look });
          toast("This look's image isn't in this browser, so your background stayed as it was.");
          return;
        }
      } else {
        await patch({
          theme: { ...look, backgroundId: p.backgroundId, customBackgroundUrl: null },
        });
      }
      toast(`${p.name} applied`, { tone: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not apply that look');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {presets.length > 0 && (
        <div className="preset-grid">
          {presets.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              resolved={resolved}
              busy={busy}
              onApply={() => void apply(p)}
              onRename={(n) => setPresets(renamePreset(p.id, n))}
              onDelete={() => {
                if (window.confirm(`Delete the look "${p.name}"?`))
                  void deletePreset(p.id).then(setPresets);
              }}
            />
          ))}
        </div>
      )}
      {naming ? (
        <form
          className="flex items-end gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            label="Name this look"
            placeholder="e.g. Late night"
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={presets.length >= MAX_PRESETS}
            onClick={() => setNaming(true)}
          >
            <Plus size={14} aria-hidden /> Save current look
          </Button>
        </div>
      )}
      <span className="field-hint">Your current appearance settings saved as a preset.</span>
    </>
  );
}
