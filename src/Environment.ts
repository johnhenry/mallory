/**
 * Environment — a symbol table mapping string keys to values, with a separate
 * pool of immutable bindings. Used by {@link StringEvaluator} and
 * {@link Expression} to resolve variables and functions.
 *
 * Ported from Mallory's ActionScript `Enviornment` (the original class name was
 * misspelled; corrected here). Deep-clone via Flash `ByteArray` serialisation is
 * replaced with an ordinary entry copy — values are treated as immutable data.
 */
export class Environment {
  private _items = new Map<string, unknown>();
  private _immutableItems = new Map<string, unknown>();

  /**
   * Each consecutive pair of arguments `(key, value)` becomes an immutable
   * binding. A trailing unpaired argument is ignored.
   */
  constructor(...rest: unknown[]) {
    if (rest.length % 2 === 1) rest.pop();
    for (let i = 0; i < rest.length; i += 2) {
      if (typeof rest[i] === "string") this.assignImmutable(rest[i] as string, rest[i + 1]);
    }
  }

  existKey(request: string): boolean {
    return this._immutableItems.has(request) || this._items.has(request);
  }

  existImmutableKey(request: string): boolean {
    return this._immutableItems.has(request);
  }

  existValue(request: unknown): boolean {
    for (const v of this._immutableItems.values()) if (v === request) return true;
    for (const v of this._items.values()) if (v === request) return true;
    return false;
  }

  toString(showImmutable = true, showRest = true): string {
    const result: string[] = [];
    if (showImmutable) for (const [k, v] of this._immutableItems) result.push(`${k} : ${v}`);
    if (showRest) for (const [k, v] of this._items) result.push(`${k} : ${v}`);
    return `{${result.join(" ; ")}}`;
  }

  /** A copy of the environment (bindings are shared by reference). */
  clone(): Environment {
    const out = new Environment();
    out._items = new Map(this._items);
    out._immutableItems = new Map(this._immutableItems);
    return out;
  }

  get size(): number {
    return this._items.size + this._immutableItems.size;
  }

  get keys(): string[] {
    return [...this._immutableItems.keys(), ...this._items.keys()];
  }

  get immutableKeys(): string[] {
    return [...this._immutableItems.keys()];
  }

  get values(): unknown[] {
    return [...this._immutableItems.values(), ...this._items.values()];
  }

  /** Bind `key` to `value`. Assigning `undefined` (or the key to itself) removes it. */
  assign(key: string, value?: unknown): boolean {
    if (value === undefined || (key as unknown) === value) return this.remove(key);
    if (this.existImmutableKey(key)) return false;
    this._items.set(key, value);
    return true;
  }

  /** Bind `key` immutably. Fails if the key already exists in either pool. */
  assignImmutable(key: string, value?: unknown): boolean {
    if (value === undefined || (key as unknown) === value) return this.remove(key);
    if (this.existKey(key)) return false;
    this._immutableItems.set(key, value);
    return true;
  }

  /** Bind `key` to `value` after first resolving `value` in this environment. */
  assignDeep(key: string, value: string): boolean {
    return this.assign(key, this.retrieveDeep(value));
  }

  assignImmutableDeep(key: string, value: string): boolean {
    return this.assignImmutable(key, this.retrieveDeep(value));
  }

  /** Look up `key`; an unknown key resolves to itself (symbolic passthrough). */
  retrieve(key: string): unknown {
    if (!this.existKey(key)) return key;
    if (this.existImmutableKey(key)) return this._immutableItems.get(key);
    return this._items.get(key);
  }

  /** Follow chains of string references to the deepest concrete value. */
  retrieveDeep(key: string): unknown {
    let previous = this.retrieve(key);
    for (let i = 0; i < this.size; i++) {
      if (previous === key) return key;
      if (typeof previous !== "string" || previous === this.retrieve(previous)) return previous;
      previous = this.retrieve(previous);
    }
    return undefined;
  }

  /** Remove a mutable binding (immutable ones cannot be removed). */
  remove(key: string): boolean {
    if (this.existImmutableKey(key)) return false;
    return this._items.delete(key);
  }

  /** Remove an immutable binding (for debugging; normally you should not). */
  removeImmutable(key: string): boolean {
    return this._immutableItems.delete(key);
  }
}
