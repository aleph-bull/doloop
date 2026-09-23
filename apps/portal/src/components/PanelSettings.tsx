import type { PanelStyle } from '@komodoit/core';
import { useRef, useState } from 'react';
import { Button, Panel, Segmented, Slider, useToast } from '@komodoit/ui';
import { api } from '../lib/api';

type DeepPatch = { theme: { panel?: PanelStyle; panelColor?: string; panelAlpha?: number } };

export interface PanelSettingsProps {
  panel: PanelStyle;
  panelColor: string;
  panelAlpha: number;
  onChange: (patch: DeepPatch) => Promise<unknown>;
}

/** Surface for dense panels: opaque (default), glass, or any colour with opacity. */
export function PanelSettings({ panel, panelColor, panelAlpha, onChange }: PanelSettingsProps) {
  const [alpha, setAlpha] = useState(panelAlpha);
  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <span className="field-label">Panels</span>
        <Segmented
          ariaLabel="Panel surface"
          value={panel}
          onChange={(v) => onChange({ theme: { panel: v } })}
          options={[
            { value: 'opaque', label: 'Opaque' },
            { value: 'glass', label: 'Glass' },
            { value: 'custom', label: 'Custom colour' },
          ]}
        />
        <span className="field-hint">
          Task lists, tables, and settings sit on panels. Glass shows the background through them;
          text colour adapts automatically so it stays readable.
        </span>
      </div>
      {panel === 'custom' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="color"
                aria-label="Panel colour"
                value={panelColor}
                onChange={(e) => onChange({ theme: { panelColor: e.target.value } })}
              />
              Colour
            </label>
            <div className="field flex-1" style={{ minWidth: 200 }}>
              <span className="field-label">Opacity {Math.round(alpha * 100)}%</span>
              <Slider
                min={0.2}
                max={1}
                step={0.05}
                value={alpha}
                onChange={setAlpha}
                onMouseUp={() => onChange({ theme: { panelAlpha: alpha } })}
                onTouchEnd={() => onChange({ theme: { panelAlpha: alpha } })}
                onKeyUp={() => onChange({ theme: { panelAlpha: alpha } })}
                aria-label="Panel opacity"
              />
            </div>
          </div>
        </div>
      )}
      <Panel className="p-4 text-sm">
        <div className="font-medium">Preview</div>
        <div className="muted">This is how panel text looks on the surface you picked.</div>
      </Panel>
    </div>
  );
}

const MAX_EDGE = 2048;

/** Downscale to <= 2048px on the long edge and encode as JPEG (or keep PNG for transparency). */
async function prepareImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(mime, 0.86);
}

export interface BackgroundUploadProps {
  hasUpload: boolean;
  onChanged: () => void;
}

export function BackgroundUpload({ hasUpload, onChanged }: BackgroundUploadProps) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await prepareImage(file);
      const res = await api.uploadBackground(dataUrl);
      toast(`Background set (${Math.round(res.bytes / 1024)} KB)`, { tone: 'ok' });
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        id="bg-upload"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <Button loading={busy} onClick={() => input.current?.click()}>
        {hasUpload ? 'Replace uploaded image' : 'Upload an image'}
      </Button>
      {hasUpload && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            api
              .deleteBackground()
              .then(onChanged)
              .catch((e) => toast(e.message))
          }
        >
          Remove upload
        </Button>
      )}
      <span className="field-hint">
        JPEG, PNG, or WebP. Resized to 2048 px and stored with your account.
      </span>
    </div>
  );
}
