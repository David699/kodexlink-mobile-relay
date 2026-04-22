export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}

