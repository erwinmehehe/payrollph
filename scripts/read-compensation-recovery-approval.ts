import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export const MAX_COMPENSATION_RECOVERY_APPROVAL_BYTES = 8192;

/**
 * Open exactly one file descriptor and perform a bounded read from that
 * descriptor. A separate stat(path) then read(path) creates a pathname race:
 * the file could be swapped between validation and reading.
 *
 * The signed approval is checked independently for authenticity and exact
 * tenant/intent/version by verifyCompensationRecoveryApproval; this helper
 * only ensures a bounded, regular, non-symlink file read.
 */
export function readSignedCompensationRecoveryApprovalFile(path: string): unknown {
  if (typeof path !== "string" || !path || path.includes("\0")) {
    throw new Error("A regular signed recovery approval file is required.");
  }

  // Never follow a final-component symlink. O_NONBLOCK also prevents blocking
  // on a FIFO before the regular-file check can reject it.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("Recovery approval must be a regular file.");
    }

    // The extra byte is a hard upper-bound detector; no unbounded readFileSync.
    const buffer = Buffer.alloc(MAX_COMPENSATION_RECOVERY_APPROVAL_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (count === 0) break;
      used += count;
    }

    if (used === 0 || used > MAX_COMPENSATION_RECOVERY_APPROVAL_BYTES) {
      throw new Error("Recovery approval is missing or exceeds the size limit.");
    }

    // Reject files with extra data; parse only what came from this same fd.
    return JSON.parse(buffer.subarray(0, used).toString("utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}
