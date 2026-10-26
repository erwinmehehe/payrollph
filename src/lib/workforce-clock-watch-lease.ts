/** Lease loss must escape optional-monitor error isolation and stop the tick. */
export class ClockWatchLeaseLostError extends Error {
  constructor() {
    super("Clock-in watch no longer holds the central scheduler lease.");
    this.name = "ClockWatchLeaseLostError";
  }
}

/** Never resume an attempt after a failed fence, even if a later probe recovers. */
export function clockWatchLeaseFence(assertLeaseOwnership: () => Promise<void>) {
  let lost = false;
  return async () => {
    if (lost || typeof assertLeaseOwnership !== "function") throw new ClockWatchLeaseLostError();
    try {
      await assertLeaseOwnership();
    } catch {
      lost = true;
      // Do not leak driver errors or scheduler tokens through the watch result.
      throw new ClockWatchLeaseLostError();
    }
  };
}
