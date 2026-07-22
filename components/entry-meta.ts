export const ENTRY_KINDS = [
  { value: 'journal', label: 'Journal' },
  { value: 'note', label: 'Note' },
  { value: 'conversation', label: 'Conversation' },
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number]['value'];

export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** value for <input type="datetime-local"> in local time */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
