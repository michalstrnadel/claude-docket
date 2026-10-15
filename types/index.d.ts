export type Status = 'todo' | 'doing' | 'done' | 'blocked'
export type Item = { id: number; title: string; status: Status; note?: string; updated: string }
export type List = { name: string; collapsed?: boolean; items: Item[] }
export type Board = { version: 1; title: string; nextId: number; lists: List[] }
export type Filter = 'all' | 'open'

declare module 'claude-code' {
  interface PluginState {
    docket: { board: Board | null; error: string | null; filter: Filter; addTo: string; compact: boolean; paneOpen: boolean }
  }
}
