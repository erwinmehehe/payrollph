/**
 * Private browser queue for employee-approved offline punch intent.
 * No photos, payroll records, raw GPS, IP, or fingerprint data enter IndexedDB.
 * An IndexedDB write is NOT a recorded punch; only an HR-reviewed server receipt.
 */
export type OfflinePunchIntent = {
  id: string;
  organizationId: number;
  employeeId: number;
  actionType: "clock_in" | "clock_out" | "break_start" | "break_end";
  deviceTimestamp: string;
  worksiteId: number | null;
  deviceToken: string;
};
const DB = "linaw-offline-punch-evidence-v1";
const STORE = "pending";
const META = "metadata";

function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support offline attendance evidence."));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Offline queue unavailable."));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openOfflineDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      let result: T;
      const request = requestFor(transaction.objectStore(store));
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("Offline queue transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline queue transaction aborted."));
    });
  } finally {
    db.close();
  }
}

export function scopedOfflinePunches(
  intents: readonly OfflinePunchIntent[],
  organizationId: number,
  employeeId: number,
) {
  return intents.filter(intent =>
    intent.organizationId === organizationId && intent.employeeId === employeeId);
}

export async function listOfflinePunches(organizationId: number, employeeId: number) {
  const all = await transact<OfflinePunchIntent[]>(STORE, "readonly", store => store.getAll());
  return scopedOfflinePunches(all, organizationId, employeeId)
    .sort((a, b) => a.deviceTimestamp.localeCompare(b.deviceTimestamp) || a.id.localeCompare(b.id));
}

async function deviceToken(organizationId: number, employeeId: number) {
  // Stable per installation, not per employee, so sharing is reviewable.
  const key = "installation-device-token";
  const existing = await transact<{ key: string; token: string } | undefined>(
    META, "readonly", store => store.get(key),
  );
  if (existing?.token) return existing.token;
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    throw new Error("Secure random device identity is unavailable.");
  }
  const token = crypto.randomUUID();
  // Persist installation token: only opaque UUID; server stores only HMAC hash.
  await transact(META, "readwrite", store => store.put({ key, token }));
  return token;
}

export async function queueOfflinePunch(input: {
  organizationId: number;
  employeeId: number;
  actionType: OfflinePunchIntent["actionType"];
  worksiteId?: number | null;
}): Promise<OfflinePunchIntent> {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId < 1
    || !Number.isSafeInteger(input.employeeId) || input.employeeId < 1) {
    throw new Error("Select a valid employee and employer.");
  }
  const device = await deviceToken(input.organizationId, input.employeeId);
  const intent: OfflinePunchIntent = {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    actionType: input.actionType,
    worksiteId: input.worksiteId ?? null,
    deviceTimestamp: new Date().toISOString(),
    deviceToken: device,
  };
  await transact(STORE, "readwrite", store => store.put(intent));
  return intent;
}
export async function removeOfflinePunch(id: string) {
  return transact<undefined>(STORE, "readwrite", store => store.delete(id));
}
