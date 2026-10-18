import { createDecipheriv, createPrivateKey, constants, privateDecrypt } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeIdentity } from './audit-runtime-identity.mjs';

const AAD = 'payrollph-audit-runtime-identity:v1';
const ALGORITHM = 'RSA-OAEP-SHA256+A256GCM';
const EVIDENCE_SCOPE = 'PRIVATE_RUNTIME_SESSION_IDENTITY_NOT_PRIVILEGE_PROOF';
const CAPTURE_SCOPE = 'PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL';
const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const fail = code => { throw new Error('AUDIT_RUNTIME_' + code); };

function exactFields(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function strictBase64(value, maxBytes, exactBytes) {
  if (typeof value !== 'string' || value.length === 0
    || value.length > Math.ceil(maxBytes * 4 / 3) + 8
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('INVALID_ENVELOPE');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.length > maxBytes
    || (exactBytes !== undefined && decoded.length !== exactBytes)
    || decoded.toString('base64') !== value) fail('INVALID_ENVELOPE');
  return decoded;
}

export function decryptRuntimeIdentity(envelope, privateKey) {
  if (!exactFields(envelope, ['version', 'algorithm', 'aad', 'wrappedKey', 'iv', 'tag', 'ciphertext'])
    || envelope.version !== 1 || envelope.algorithm !== ALGORITHM || envelope.aad !== AAD)
    fail('INVALID_ENVELOPE');

  let key;
  try { key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey)
    ? createPrivateKey(privateKey) : privateKey; } catch { fail('INVALID_PRIVATE_KEY'); }
  const bits = key?.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key?.type !== 'private' || key.asymmetricKeyType !== 'rsa' || bits < 3072 || bits > 8192)
    fail('INVALID_PRIVATE_KEY');

  const wrapped = strictBase64(envelope.wrappedKey, 1024, bits / 8);
  const iv = strictBase64(envelope.iv, 12, 12);
  const tag = strictBase64(envelope.tag, 16, 16);
  const ciphertext = strictBase64(envelope.ciphertext, 4096);
  let aes;
  let decrypted;
  try {
    aes = privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped);
    if (aes.length !== 32) fail('INVALID_ENVELOPE');
    const decipher = createDecipheriv('aes-256-gcm', aes, iv);
    decipher.setAAD(Buffer.from(AAD));
    decipher.setAuthTag(tag);
    decrypted = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } catch {
    fail('INVALID_ENVELOPE');
  } finally {
    aes?.fill(0);
  }

  if (!exactFields(decrypted, ['evidenceScope', 'deploymentSha', 'deploymentEnvironment', 'generatedAt', 'database'])
    || !exactFields(decrypted.database, ['projectId', 'branchId', 'endpointId', 'databaseName', 'roleName', 'inRecovery'])
    || decrypted.evidenceScope !== EVIDENCE_SCOPE || decrypted.deploymentEnvironment !== 'production'
    || typeof decrypted.deploymentSha !== 'string' || !/^[a-f0-9]{40}$/.test(decrypted.deploymentSha)
    || typeof decrypted.generatedAt !== 'string') fail('INVALID_EVIDENCE');

  try {
    const generatedAt = new Date(decrypted.generatedAt).toISOString();
    if (generatedAt !== decrypted.generatedAt) fail('INVALID_EVIDENCE');
    // The capture validator pins the project, branch, endpoint, database, role shape and primary state.
    // Supply the historical capture timestamp as "now": offline decryption can occur after 5 minutes.
    const normalized = validateRuntimeIdentity(
      { ...decrypted, evidenceScope: CAPTURE_SCOPE }, decrypted.deploymentSha, Date.parse(generatedAt));
    if (JSON.stringify(normalized) !== JSON.stringify(decrypted)) fail('INVALID_EVIDENCE');
  } catch {
    fail('INVALID_EVIDENCE');
  }
  return decrypted;
}

function boundedFile(path, maxBytes) {
  // Inspect and read the same open descriptor, not the pathname after a separate
  // stat(). O_NOFOLLOW rejects symlinked evidence/private keys on POSIX.
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY
      | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > maxBytes) fail('INVALID_INPUT');

    // Bound the bytes actually read as well: a concurrent writer must not turn
    // a small file into an unbounded allocation after the initial fstat.
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length === 0 || length > maxBytes) fail('INVALID_INPUT');
    const text = buffer.toString('utf8', 0, length);
    buffer.fill(0);
    return text;
  } catch {
    fail('INVALID_INPUT');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function decryptRuntimeIdentityToFile(artifactPath, privateKeyPath, outputPath, env = process.env) {
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') fail('OFFLINE_ONLY');
  // Native Windows mode bits do not establish private NTFS permissions, and
  // Node does not expose its POSIX no-follow open guarantee there. Refuse
  // before reading a private key or plaintext identity; use a trusted POSIX
  // filesystem (including the Linux home directory inside WSL) instead.
  if (process.platform === 'win32' || !Number.isInteger(fsConstants.O_NOFOLLOW)
    || fsConstants.O_NOFOLLOW === 0) fail('POSIX_OPERATOR_REQUIRED');
  // Canonicalize the destination parent so a symlinked directory cannot bypass this guard.
  const requestedOutput = resolve(outputPath);
  const directory = realpathSync(dirname(requestedOutput));
  // Use the canonical directory for the actual write, not the potentially
  // symlinked pathname that was checked above.
  const output = join(directory, basename(requestedOutput));
  const fromRoot = relative(ROOT, directory);
  if (fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith('..' + sep)
    && !isAbsolute(fromRoot))) fail('OUTPUT_OUTSIDE_REPOSITORY_REQUIRED');
  const directoryInfo = statSync(directory);
  if (!directoryInfo.isDirectory() || (directoryInfo.mode & 0o022) !== 0)
    fail('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');

  const envelope = JSON.parse(boundedFile(artifactPath, 32768));
  const privatePem = boundedFile(privateKeyPath, 16384);
  const identity = decryptRuntimeIdentity(envelope, privatePem);
  // Never overwrite evidence or follow an existing output symlink; permissions are user-only.
  writeFileSync(output, JSON.stringify(identity, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { written: true, privilegesProven: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) fail('USAGE');
    decryptRuntimeIdentityToFile(process.argv[2], process.argv[3], process.argv[4]);
    console.log('AUDIT_RUNTIME_IDENTITY_DECRYPTED_LOCALLY_NOT_PRIVILEGE_PROOF');
  } catch (error) {
    const code = error instanceof Error && /^AUDIT_RUNTIME_[A-Z_]+$/.test(error.message)
      ? error.message : 'AUDIT_RUNTIME_DECRYPT_FAILED';
    console.error(code);
    process.exitCode = 1;
  }
}
