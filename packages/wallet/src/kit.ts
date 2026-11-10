// Thin wrapper around Stellar Wallets Kit. Apps never import the kit directly.
// The kit is loaded lazily so it doesn't weigh down first paint (important for the pay app).
// This package never sees a secret key — wallets sign, we only pass XDR in and out.
import {
  checkNetwork,
  NETWORK_PASSPHRASES,
  type StellarNetwork,
  type WalletCheck,
} from './network';
import { MessageSigningUnsupportedError } from './errors';

type Kit = typeof import('@creit.tech/stellar-wallets-kit/sdk').StellarWalletsKit;

let kitPromise: Promise<Kit> | null = null;

async function loadKit(network: StellarNetwork): Promise<Kit> {
  kitPromise ??= (async () => {
    const [{ StellarWalletsKit }, { defaultModules }, { Networks }] = await Promise.all([
      import('@creit.tech/stellar-wallets-kit/sdk'),
      import('@creit.tech/stellar-wallets-kit/modules/utils'),
      import('@creit.tech/stellar-wallets-kit/types'),
    ]);
    StellarWalletsKit.init({
      modules: defaultModules(),
      network: network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
    });
    return StellarWalletsKit;
  })();
  return kitPromise;
}

export interface WalletClient {
  /** Opens the wallet picker and returns the connected public address. */
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  /** Compare the wallet's network with the app's. Call before every signature. */
  checkNetwork(): Promise<WalletCheck>;
  /** Sign an unsigned XDR built by the backend. Always show a readable summary first. */
  signTransaction(xdr: string, opts: { address: string }): Promise<{ signedXdr: string }>;
  /**
   * Sign a plain-text message (SEP-53) to prove control of `address`. Returns the base64
   * signature. Throws MessageSigningUnsupportedError if the wallet can't sign messages.
   */
  signMessage(message: string, opts: { address: string }): Promise<{ signature: string }>;
}

export function createWalletClient(network: StellarNetwork): WalletClient {
  return {
    async connect() {
      const kit = await loadKit(network);
      return kit.authModal();
    },
    async disconnect() {
      const kit = await loadKit(network);
      await kit.disconnect();
    },
    async checkNetwork() {
      const kit = await loadKit(network);
      const { networkPassphrase } = await kit.getNetwork();
      return checkNetwork(network, networkPassphrase);
    },
    async signTransaction(xdr, { address }) {
      const kit = await loadKit(network);
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        address,
        networkPassphrase: NETWORK_PASSPHRASES[network],
      });
      return { signedXdr: signedTxXdr };
    },
    async signMessage(message, { address }) {
      const kit = await loadKit(network);
      try {
        const { signedMessage, signerAddress } = await kit.signMessage(message, {
          address,
          networkPassphrase: NETWORK_PASSPHRASES[network],
        });
        if (signerAddress && signerAddress !== address) {
          throw new Error(`The wallet signed with ${signerAddress} instead of ${address}.`);
        }
        return { signature: signedMessage };
      } catch (e) {
        if (isUnsupported(e)) throw new MessageSigningUnsupportedError();
        throw e;
      }
    },
  };
}

// The kit reports unimplemented methods as `{ code: -3, message: '... does not support ...' }`.
function isUnsupported(e: unknown): boolean {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown };
  return code === -3 || /does not support|not supported|not implemented/i.test(String(message));
}
