// Fake wallet for tests and demos. Never used in production code.
import { Keypair } from '@stellar/stellar-sdk';
import { MessageSigningUnsupportedError } from './errors';
import type { WalletClient } from './kit';
import { NETWORK_PASSPHRASES, checkNetwork, type StellarNetwork } from './network';

export interface FakeWalletOptions {
  address: string;
  /** Network the fake wallet claims to be on. */
  walletNetwork?: StellarNetwork;
  /** Make connect/sign fail with this message (e.g. "User declined"). */
  failWith?: string;
  /** Produce a base64 message signature. Defaults to a fake `sig:<message>` string. */
  messageSigner?: (message: string) => Promise<string> | string;
  /** Simulate a wallet (e.g. Albedo) that can't sign messages. */
  supportsMessageSigning?: boolean;
}

/** A real SEP-53 signer for tests: base64(ed25519(sha256("Stellar Signed Message:\n" + m))). */
export function sep53Signer(keypair: Keypair) {
  return async (message: string) => {
    const bytes = new TextEncoder().encode(`Stellar Signed Message:\n${message}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const signature = keypair.sign(digest as Parameters<Keypair['sign']>[0]);
    return btoa(String.fromCharCode(...signature));
  };
}

export { Keypair };

export function createFakeWalletClient(appNetwork: StellarNetwork, options: FakeWalletOptions) {
  const calls = { signed: [] as string[], messages: [] as string[] };
  const client: WalletClient = {
    async connect() {
      if (options.failWith) throw new Error(options.failWith);
      return { address: options.address };
    },
    async disconnect() {},
    async checkNetwork() {
      return checkNetwork(appNetwork, NETWORK_PASSPHRASES[options.walletNetwork ?? appNetwork]);
    },
    async signTransaction(xdr) {
      if (options.failWith) throw new Error(options.failWith);
      calls.signed.push(xdr);
      return { signedXdr: `signed:${xdr}` };
    },
    async signMessage(message) {
      if (options.supportsMessageSigning === false) throw new MessageSigningUnsupportedError();
      if (options.failWith) throw new Error(options.failWith);
      calls.messages.push(message);
      const signature = options.messageSigner
        ? await options.messageSigner(message)
        : `sig:${message}`;
      return { signature };
    },
  };
  return { client, calls };
}
