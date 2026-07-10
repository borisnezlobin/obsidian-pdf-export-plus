// Node/Electron modules are available in Obsidian's desktop renderer via
// window.require. Centralize access so the rest of the code stays clean and the
// plugin fails loudly if run somewhere without it.

type RequireFn = (id: string) => any;

const raw: RequireFn | undefined = (window as any).require;

export function req(id: string): any {
  if (!raw) throw new Error(`Node module "${id}" unavailable (desktop only)`);
  return raw(id);
}
