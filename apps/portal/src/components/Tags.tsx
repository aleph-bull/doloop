import {
  TAG_COLORS,
  nextTagColor,
  tagsOf,
  type StudyNode,
  type Tag,
  type TagColor,
} from '@komogon/core';
import { Check, ChevronLeft, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Panel, useToast, useVisualViewportFit } from '@komogon/ui';
import { NARROW_QUERY, useMediaQuery } from '../lib/media';
import { useCreateTag, useDeleteTag, useSetNodeTags, useTags, useUpdateTag } from '../lib/queries';

const COLOR_NAME: Record<TagColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  brown: 'Brown',
  gray: 'Grey',
};

/** One tag as a small tinted pill. With `onRemove`, an x takes it off. */
export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className={`tag-chip is-${tag.color}`}>
      <span className="tag-chip-name">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          className="tag-chip-x"
          aria-label={`Remove ${tag.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  );
}

/** The tags for a list of ids, in order, skipping any that were deleted. */
export function useTagList(ids: readonly string[] | undefined): Tag[] {
  const all = useTags().data?.tags;
  return useMemo(() => tagsOf(ids, new Map((all ?? []).map((t) => [t.id, t]))), [ids, all]);
}

type Option = { kind: 'tag'; tag: Tag } | { kind: 'create'; name: string };

/**
 * The tag menu, Notion-style: the node's tags at the top with the search box, then every
 * tag to pick from. Typing a name that doesn't exist offers to make it. The dots beside a
 * tag rename it, change its colour or delete it. Floats over the page beside `anchor`.
 */
export function TagPicker({
  anchor,
  nodeId,
  title,
  selected,
  onClose,
}: {
  anchor: HTMLElement;
  nodeId: string;
  /** The node's name, for the menu's label. */
  title: string;
  selected: string[];
  onClose: () => void;
}) {
  const tags = useTags();
  const setTags = useSetNodeTags();
  const create = useCreateTag();
  const { toast } = useToast();
  const all = useMemo(() => tags.data?.tags ?? [], [tags.data]);
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);
  const chosen = tagsOf(selected, byId);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // On a phone it is a sheet along the bottom, above the keyboard when that is up, rather
  // than a menu pinned beside a cell the keyboard may have scrolled away.
  const sheet = useMediaQuery(NARROW_QUERY);
  const touch = useMediaQuery('(pointer: coarse)');
  useVisualViewportFit(box, sheet);
  // Under the anchor, or above it when there is no room below; never off the sides.
  const place = (h: number) => {
    const r = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 280), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : below;
    return { top, left, width };
  };
  const [pos, setPos] = useState(() => place(0));
  useLayoutEffect(() => {
    const again = () => setPos(place(box.current?.offsetHeight ?? 0));
    again();
    const ro = new ResizeObserver(again);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  // The search box takes the keys on opening and on coming back from editing a tag. Not on
  // a touch screen, where that would throw the keyboard up before anything was tapped.
  useEffect(() => {
    if (!editing && !touch) input.current?.focus();
  }, [editing, touch]);

  // Clicking away, Escape, or the page moving under it closes the menu.
  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (editing) setEditing(null);
      else {
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    // A menu pinned to its cell goes when the page moves under it. The phone's sheet isn't
    // pinned to anything, and its keyboard scrolls and resizes the page as it comes up.
    if (!sheet) {
      window.addEventListener('scroll', away, true);
      window.addEventListener('resize', onClose);
    }
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose, editing, sheet]);

  const q = query.trim();
  const options: Option[] = [
    ...all
      .filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
      .map((tag) => ({ kind: 'tag' as const, tag })),
    ...(q && !all.some((t) => t.name.toLowerCase() === q.toLowerCase())
      ? [{ kind: 'create' as const, name: q }]
      : []),
  ];
  const current = Math.min(active, options.length - 1);

  const save = (ids: string[]) =>
    setTags.mutate(
      { id: nodeId, tagIds: ids },
      { onError: (err) => toast(err instanceof Error ? err.message : 'Could not save the tags') },
    );
  const toggle = (id: string) =>
    save(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const choose = async (o: Option) => {
    if (o.kind === 'tag') return toggle(o.tag.id);
    try {
      const { tag } = await create.mutateAsync({ name: o.name });
      save([...selected, tag.id]);
      setQuery('');
      setActive(0);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make that tag');
    }
  };

  const editingTag = editing ? byId.get(editing) : undefined;

  return createPortal(
    <>
      {/* The sheet's scrim takes the tap that closes it, so nothing under it is hit. */}
      {sheet && <div className="tag-pop-scrim" aria-hidden />}
      <div
        ref={box}
        className={`glass glass-strong tag-pop${sheet ? ' is-sheet' : ''}`}
        role="dialog"
        aria-label={`Tags for ${title}`}
        style={sheet ? undefined : { top: pos.top, left: pos.left, width: pos.width }}
      >
        {editingTag ? (
          <TagEditor tag={editingTag} onBack={() => setEditing(null)} />
        ) : (
          <>
            <div className="tag-pop-field" onClick={() => input.current?.focus()}>
              {chosen.map((t) => (
                <TagChip key={t.id} tag={t} onRemove={() => toggle(t.id)} />
              ))}
              <input
                ref={input}
                className="tag-pop-input"
                value={query}
                aria-label="Search or make a tag"
                placeholder={chosen.length ? '' : 'Search or make a tag'}
                maxLength={40}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!options.length) return;
                    const step = e.key === 'ArrowDown' ? 1 : -1;
                    setActive((current + step + options.length) % options.length);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const o = options[current];
                    if (o) void choose(o);
                  } else if (e.key === 'Backspace' && !query && selected.length) {
                    save(selected.slice(0, -1));
                  }
                }}
              />
            </div>
            <div className="tag-pop-list" role="listbox" aria-label="Tags">
              {options.length > 0 && (
                <div className="tag-pop-hint">
                  {all.length ? 'Pick a tag or make one' : 'Type a name to make your first tag'}
                </div>
              )}
              {options.map((o, i) =>
                o.kind === 'tag' ? (
                  <div
                    key={o.tag.id}
                    className={`tag-pop-option${i === current ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={selected.includes(o.tag.id)}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void choose(o)}
                  >
                    <TagChip tag={o.tag} />
                    <span className="tag-pop-check" aria-hidden>
                      {selected.includes(o.tag.id) && <Check size={14} />}
                    </span>
                    <button
                      type="button"
                      className="tag-pop-more"
                      aria-label={`Edit the ${o.tag.name} tag`}
                      title="Rename, colour, delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(o.tag.id);
                      }}
                    >
                      <MoreHorizontal size={15} aria-hidden />
                    </button>
                  </div>
                ) : (
                  <div
                    key="create"
                    className={`tag-pop-option${i === current ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={false}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void choose(o)}
                  >
                    <span className="tag-pop-create">Make</span>
                    <TagChip
                      tag={{ id: '', name: o.name, color: nextTagColor(all), sortOrder: 0 }}
                    />
                  </div>
                ),
              )}
              {!options.length && !q && <div className="tag-pop-hint">No tags yet</div>}
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/** The nine colours as dots; clicking one recolours the tag at once. */
function ColorSwatches({ tag, onError }: { tag: Tag; onError: (err: unknown) => void }) {
  const update = useUpdateTag();
  return (
    <div className="tag-edit-colors" role="radiogroup" aria-label={`Colour of ${tag.name}`}>
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={tag.color === c}
          aria-label={COLOR_NAME[c]}
          title={COLOR_NAME[c]}
          className={`tag-swatch is-${c}`}
          onClick={() => update.mutate({ id: tag.id, patch: { color: c } }, { onError })}
        />
      ))}
    </div>
  );
}

const tasksWord = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * The Tags card under the task table: every tag with the tasks it is on, its colour, and
 * rename and delete. Tags can be made here too, before any task has them.
 */
export function TagManager({ nodes }: { nodes: StudyNode[] }) {
  const tags = useTags();
  const create = useCreateTag();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const all = tags.data?.tags ?? [];
  const usedOn = useMemo(() => {
    const m = new Map<string, StudyNode[]>();
    for (const n of nodes) for (const id of n.tagIds ?? []) m.set(id, [...(m.get(id) ?? []), n]);
    return m;
  }, [nodes]);

  const add = async () => {
    const next = name.trim();
    if (!next) return;
    try {
      await create.mutateAsync({ name: next });
      setName('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make that tag');
    }
  };

  return (
    <Panel as="section" className="tag-manager" aria-labelledby="tag-manager-h">
      <div className="tag-manager-head">
        <h2 id="tag-manager-h" className="card-title">
          Tags
        </h2>
        <form
          className="tag-manager-new"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            className="input tag-manager-input"
            value={name}
            maxLength={40}
            placeholder="New tag"
            aria-label="New tag name"
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={create.isPending}
            disabled={!name.trim()}
          >
            <Plus size={14} aria-hidden /> Add
          </Button>
        </form>
      </div>
      {tags.isLoading ? null : all.length === 0 ? (
        <p className="tag-manager-empty">No tags yet. Make one here, or from a task's Tags cell.</p>
      ) : (
        <ul className="tag-manager-grid">
          {all.map((t) => (
            <TagTile key={t.id} tag={t} usedOn={usedOn.get(t.id) ?? []} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One tag in the manager: what it's on, its colour, rename and delete. */
function TagTile({ tag, usedOn }: { tag: Tag; usedOn: StudyNode[] }) {
  const update = useUpdateTag();
  const del = useDeleteTag();
  const { toast } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [sure, setSure] = useState(false);
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not save');
  const count = usedOn.length;

  const rename = () => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === tag.name) return setName(tag.name);
    update.mutate(
      { id: tag.id, patch: { name: next } },
      { onError: (e) => (fail(e), setName(tag.name)) },
    );
  };

  return (
    <li className="tag-tile">
      <div className="tag-tile-head">
        {renaming ? (
          <input
            className="tag-edit-name tag-tile-name"
            value={name}
            aria-label={`New name for ${tag.name}`}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                rename();
              } else if (e.key === 'Escape') {
                setName(tag.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <TagChip tag={tag} />
        )}
        <span className="tag-tile-count tabular">{count ? tasksWord(count) : 'Not used yet'}</span>
      </div>
      {count > 0 && <p className="tag-tile-where">{usedOn.map((n) => n.title).join(' · ')}</p>}
      {sure ? (
        <div className="tag-tile-sure">
          <span>
            Delete {tag.name}?{count ? ` It comes off ${tasksWord(count)}.` : ''}
          </span>
          <span className="tag-edit-actions">
            <Button
              size="sm"
              variant="danger"
              loading={del.isPending}
              onClick={() => del.mutate(tag.id, { onError: fail })}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
              Keep
            </Button>
          </span>
        </div>
      ) : (
        <div className="tag-tile-foot">
          <ColorSwatches tag={tag} onError={fail} />
          <span className="tag-tile-actions">
            <button
              type="button"
              className="tt-action"
              aria-label={`Rename ${tag.name}`}
              title="Rename"
              onClick={() => {
                setName(tag.name);
                setRenaming(true);
              }}
            >
              <Pencil size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="tt-action"
              aria-label={`Delete ${tag.name}`}
              title="Delete"
              onClick={() => setSure(true)}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

/** Rename a tag, pick its colour, or delete it (asked first). */
function TagEditor({ tag, onBack }: { tag: Tag; onBack: () => void }) {
  const update = useUpdateTag();
  const del = useDeleteTag();
  const { toast } = useToast();
  const [name, setName] = useState(tag.name);
  const [sure, setSure] = useState(false);
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : 'Could not save');

  const rename = () => {
    const next = name.trim();
    if (!next || next === tag.name) return setName(tag.name);
    update.mutate(
      { id: tag.id, patch: { name: next } },
      { onError: (e) => (fail(e), setName(tag.name)) },
    );
  };

  return (
    <div className="tag-edit">
      <button type="button" className="tag-edit-back" onClick={onBack}>
        <ChevronLeft size={15} aria-hidden /> Tags
      </button>
      <input
        className="tag-edit-name"
        value={name}
        aria-label="Tag name"
        maxLength={40}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            rename();
          }
        }}
      />
      <ColorSwatches tag={tag} onError={fail} />
      {sure ? (
        <div className="tag-edit-sure">
          <span>Delete {tag.name}? It comes off every task.</span>
          <span className="tag-edit-actions">
            <Button
              size="sm"
              variant="danger"
              loading={del.isPending}
              onClick={() => del.mutate(tag.id, { onSuccess: onBack, onError: fail })}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
              Keep
            </Button>
          </span>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="tag-edit-delete" onClick={() => setSure(true)}>
          <Trash2 size={14} aria-hidden /> Delete tag
        </Button>
      )}
    </div>
  );
}
