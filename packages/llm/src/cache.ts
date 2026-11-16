export interface LLMCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
}

export class InMemoryLLMCache implements LLMCache {
  private readonly map = new Map<string, unknown>();

  get(key: string) {
    return this.map.get(key);
  }

  set(key: string, value: unknown) {
    this.map.set(key, value);
  }
}
