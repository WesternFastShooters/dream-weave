export type ProjectId = string;
export type ItemId = string;
export type CommandId = string;

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
