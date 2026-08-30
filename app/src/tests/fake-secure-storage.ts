/**
 * In-memory secure storage for tests that run the real auth store. The web
 * implementation encrypts with WebCrypto, which jsdom does not provide.
 */
const store = new Map<string, string>();
export async function setSecureValue(key: string, value: string): Promise<void> { store.set(key, value); }
export async function getSecureValue(key: string): Promise<string | null> { return store.get(key) ?? null; }
export async function removeSecureValue(key: string): Promise<void> { store.delete(key); }
export async function hasSecureValue(key: string): Promise<boolean> { return store.has(key); }
export async function clearSecureStorage(): Promise<void> { store.clear(); }
export function resetFakeSecureStorage(): void { store.clear(); }
