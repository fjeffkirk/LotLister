'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from './UserProvider';
import { ChevronRightIcon, GearIcon, LayersIcon, LogOutIcon, PlusIcon, SearchIcon } from './ui/icons';

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

interface PaletteContext {
  open: () => void;
  register: (source: string, commands: Command[]) => () => void;
}

const Context = createContext<PaletteContext>({ open: () => undefined, register: () => () => undefined });

export function useCommandPalette() {
  return useContext(Context);
}

/** Adds page-specific commands (pass a memoized array) to the palette while the page is mounted. */
export function useRegisterCommands(source: string, commands: Command[]) {
  const { register } = useContext(Context);
  useEffect(() => register(source, commands), [register, source, commands]);
}

function matches(command: Command, terms: string[]): boolean {
  const haystack = `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { username, signOut } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [sources, setSources] = useState<Record<string, Command[]>>({});
  const [lots, setLots] = useState<{ id: string; name: string; completed: boolean }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  const register = useCallback((source: string, commands: Command[]) => {
    setSources((prev) => ({ ...prev, [source]: commands }));
    return () =>
      setSources((prev) => {
        const next = { ...prev };
        delete next[source];
        return next;
      });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (!username) return;
        event.preventDefault();
        setIsOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [username]);

  useEffect(() => {
    if (!isOpen || !username) return;
    fetch('/api/lots')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setLots(data.data.map((lot: { id: string; name: string; completed: boolean }) => ({ id: lot.id, name: lot.name, completed: lot.completed })));
      })
      .catch(() => undefined);
  }, [isOpen, username]);

  const commands = useMemo<Command[]>(() => {
    const pageCommands = Object.values(sources).flat();
    const navigation: Command[] = [
      { id: 'nav-new-lot', label: 'Create a new lot', group: 'General', icon: <PlusIcon />, keywords: 'add', run: () => router.push('/lots?new=1') },
      { id: 'nav-lots', label: 'Go to all lots', group: 'General', icon: <LayersIcon />, keywords: 'home dashboard', run: () => router.push('/lots') },
      { id: 'nav-settings', label: 'Account & eBay settings', group: 'General', icon: <GearIcon />, keywords: 'preferences', run: () => router.push('/settings') },
      { id: 'nav-signout', label: 'Sign out', group: 'General', icon: <LogOutIcon />, keywords: 'logout', run: () => void signOut() },
    ];
    const lotCommands: Command[] = lots.map((lot) => ({
      id: `lot-${lot.id}`,
      label: lot.name,
      group: 'Lots',
      hint: lot.completed ? 'Completed' : undefined,
      icon: <ChevronRightIcon />,
      keywords: 'open lot',
      run: () => router.push(`/lots/${lot.id}`),
    }));
    return [...pageCommands, ...navigation, ...lotCommands];
  }, [sources, lots, router, signOut]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) => !command.disabled && matches(command, terms));
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const value = useMemo(() => ({ open, register }), [open, register]);

  let lastGroup = '';
  return (
    <Context.Provider value={value}>
      {children}
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-md animate-fade-in" onMouseDown={close}>
          <div
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-surface-900/95 shadow-pop overflow-hidden animate-scale-in"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Quick actions"
          >
            <div className="flex items-center gap-3 px-4 border-b border-white/[0.07]">
              <SearchIcon size={18} className="text-surface-400 flex-shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search lots and actions…"
                className="flex-1 !bg-transparent !border-0 !ring-0 px-0 py-4 text-[15px]"
              />
              <kbd className="kbd">Esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-surface-500">Nothing matches &ldquo;{query}&rdquo;</p>
              ) : (
                results.map((command, index) => {
                  const header = command.group !== lastGroup ? command.group : null;
                  lastGroup = command.group;
                  return (
                    <div key={command.id}>
                      {header && <div className="menu-label">{header}</div>}
                      <button
                        data-index={index}
                        onMouseMove={() => setActive(index)}
                        onClick={() => run(command)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                          index === active ? 'bg-primary-500/15 text-white' : 'text-surface-200'
                        }`}
                      >
                        <span className={index === active ? 'text-primary-300' : 'text-surface-500'}>{command.icon}</span>
                        <span className="flex-1 truncate">{command.label}</span>
                        {command.hint && <span className="text-xs text-surface-500">{command.hint}</span>}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.07] text-[11px] text-surface-500">
              <span className="flex items-center gap-1"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="kbd">Enter</kbd> run</span>
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
