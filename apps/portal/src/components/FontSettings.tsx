import {
  DEFAULT_FONT,
  FREE_FONTS,
  UPLOADED_FONT_PREFIX,
  uploadedFontId,
  type UserSettings,
} from '@komogon/core';
import { useToast } from '@komogon/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Upload, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { fontStack, forgetFont, loadFont, loadFreeFonts, readableFont } from '../lib/fonts';
import {
  dropFont,
  fontNameOf,
  keepFont,
  localFonts,
  MAX_FONT_BYTES,
  type LocalFontInfo,
} from '../lib/local-fonts';
import { Popout } from './Popout';

type FontKey = 'fontTimer' | 'fontHeading' | 'fontText';
type DeepPatch = { theme: Partial<Pick<UserSettings['theme'], FontKey>> };

const FIELDS: { key: FontKey; label: string }[] = [
  { key: 'fontTimer', label: 'Timer' },
  { key: 'fontHeading', label: 'Headings' },
  { key: 'fontText', label: 'Text' },
];

const ownChoice = (id: string) => `${UPLOADED_FONT_PREFIX}${id}`;

/**
 * Settings › Appearance › Fonts: the timer, headings and text, each Inter by default, one of
 * the free fonts, or one they upload (kept in this browser, `local-fonts.ts`).
 */
export function FontSettings({
  theme,
  owner,
  onChange,
}: {
  theme: Pick<UserSettings['theme'], FontKey>;
  /** The account, so fonts added on another one in this browser stay theirs. */
  owner: string;
  onChange: (patch: DeepPatch) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  /** Which font the file picker is choosing for. */
  const target = useRef<FontKey>('fontText');
  const queryKey = ['local-fonts', owner];
  const own = useQuery({ queryKey, queryFn: () => localFonts(owner), staleTime: Infinity });
  const yours = own.data ?? [];

  const upload = async (file: File) => {
    try {
      if (file.size > MAX_FONT_BYTES) throw new Error('Too big. Up to 20 MB.');
      const data = await file.arrayBuffer();
      if (!(await readableFont(data))) throw new Error('That file isn’t a font.');
      const id = await keepFont(owner, fontNameOf(file.name), data);
      await qc.invalidateQueries({ queryKey });
      await onChange({ theme: { [target.current]: ownChoice(id) } });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (font: LocalFontInfo) => {
    if (!window.confirm(`Delete ${font.name}?`)) return;
    const choice = ownChoice(font.id);
    await dropFont(font.id);
    forgetFont(choice);
    const using = FIELDS.filter((f) => theme[f.key] === choice);
    if (using.length) {
      await onChange({ theme: Object.fromEntries(using.map((f) => [f.key, DEFAULT_FONT])) });
    }
    await qc.invalidateQueries({ queryKey });
  };

  return (
    <div className="field">
      <span className="field-label">Fonts</span>
      <div className="font-fields">
        {FIELDS.map((f) => (
          <FontField
            key={f.key}
            label={f.label}
            value={theme[f.key]}
            timer={f.key === 'fontTimer'}
            yours={yours}
            ready={own.isSuccess}
            onPick={(choice) => void onChange({ theme: { [f.key]: choice } })}
            onUpload={() => {
              target.current = f.key;
              input.current?.click();
            }}
            onRemove={(font) => void remove(font)}
          />
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

function FontField({
  label,
  value,
  timer,
  yours,
  ready,
  onPick,
  onUpload,
  onRemove,
}: {
  label: string;
  value: string;
  timer: boolean;
  yours: LocalFontInfo[];
  /** Their fonts have been read, so a missing one is really missing. */
  ready: boolean;
  onPick: (choice: string) => void;
  onUpload: () => void;
  onRemove: (font: LocalFontInfo) => void;
}) {
  const ownId = uploadedFontId(value);
  const ownFont = ownId ? yours.find((f) => f.id === ownId) : undefined;
  const missing = !!ownId && ready && !ownFont;
  const name =
    value === DEFAULT_FONT
      ? 'Default'
      : ownId
        ? (ownFont?.name ?? (missing ? 'Not on this device' : '…'))
        : (FREE_FONTS.find((f) => f.id === value)?.name ?? 'Default');

  // The chosen one, so the button shows it.
  useEffect(() => {
    void loadFont(value);
  }, [value]);

  const option = (choice: string, title: string, close: () => void, font?: LocalFontInfo) => (
    <li key={choice} className={font ? 'font-option-own' : undefined}>
      <button
        type="button"
        className="start-option"
        aria-pressed={value === choice}
        onClick={() => {
          onPick(choice);
          close();
        }}
      >
        <span
          className="start-option-text font-option-name"
          style={{ fontFamily: fontStack(choice) }}
        >
          {title}
        </span>
        {timer && (
          <span className="font-option-sample tabular" style={{ fontFamily: fontStack(choice) }}>
            25:00
          </span>
        )}
        {value === choice && <Check size={16} aria-hidden className="start-option-check" />}
      </button>
      {font && (
        <button
          type="button"
          className="font-option-delete"
          aria-label={`Delete ${font.name}`}
          onClick={() => onRemove(font)}
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </li>
  );

  return (
    // Every free font is fetched as the pointer or focus comes near, so each name in the menu
    // shows in its own font; the menu itself is on the page, hidden, from the start.
    <div className="font-field" onPointerEnter={loadFreeFonts} onFocus={loadFreeFonts}>
      <span className="font-field-label">{label}</span>
      <Popout
        label={`${label} font`}
        triggerClassName={`start-pill font-pill${missing ? ' is-off' : ''}`}
        className="is-menu font-pop"
        width={280}
        room={360}
        trigger={
          <>
            <span
              className="font-pill-name"
              style={{ fontFamily: fontStack(missing ? DEFAULT_FONT : value) }}
            >
              {name}
            </span>
            <ChevronDown size={14} aria-hidden className="start-pill-chevron" />
          </>
        }
      >
        {(close) => (
          <>
            <ul className="start-menu font-menu">
              {option(DEFAULT_FONT, 'Default', close)}
              {FREE_FONTS.map((f) => option(f.id, f.name, close))}
              {yours.length > 0 && <li className="font-menu-head">Yours</li>}
              {yours.map((f) => option(ownChoice(f.id), f.name, close, f))}
            </ul>
            <div className="start-menu-foot">
              <button
                type="button"
                className="start-option is-link"
                onClick={() => {
                  close();
                  onUpload();
                }}
              >
                <Upload size={15} aria-hidden />
                Upload a font
              </button>
            </div>
          </>
        )}
      </Popout>
    </div>
  );
}
