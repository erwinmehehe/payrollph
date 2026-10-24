import { assertPaymongoHttpProofTarget, syntheticPaymongoUrl } from './paymongo-http-proof-target.mjs';

assertPaymongoHttpProofTarget(process.env);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const request = new Request(input, options);
  const target = syntheticPaymongoUrl(request.url);
  // Only the exact test credential can be forwarded to the loopback fixture.
  const expected = 'Basic ' + Buffer.from('sk_test_synthetic_no_network:').toString('base64');
  if (request.headers.get('authorization') !== expected) throw new Error('Non-synthetic credential refused.');
  return nativeFetch(target, {
    method: request.method, headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    duplex: 'half', signal: request.signal, redirect: 'error', cache: 'no-store',
  });
};
