import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

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

  // Windows does not enforce POSIX O_NOFOLLOW. Reject final-component
  // reparse-point symlinks before opening, then require the same nonzero native
  // file identity to remain at the path and descriptor after the bounded read.
  // This is defense in depth; operator-controlled directories and signature
  // verification remain mandatory for this privileged recovery CLI.
  const original = process.platform === "win32" ? lstatSync(path, { bigint: true }) : null;
  if (original && (!original.isFile() || original.isSymbolicLink())) {
    throw new Error("Recovery approval must be a regular file, not a symlink.");
  }

  // POSIX O_NOFOLLOW blocks final-component symlinks atomically. O_NONBLOCK
  // prevents blocking on FIFOs before the regular-file check can reject them.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("Recovery approval must be a regular file.");
    }
    const opened = original ? fstatSync(fd, { bigint: true }) : null;

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

    if (original && opened) {
      const after = lstatSync(path, { bigint: true });
      if (!after.isFile() || after.isSymbolicLink() ||
          original.ino === 0n || opened.ino === 0n || after.ino === 0n ||
          original.ino !== opened.ino || after.ino !== opened.ino ||
          original.dev !== opened.dev || after.dev !== opened.dev) {
        throw new Error("Recovery approval file changed or has an unsafe Windows file identity.");
      }
    }

    // Reject files with extra data; parse only what came from this same fd.
    return JSON.parse(buffer.subarray(0, used).toString("utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}
