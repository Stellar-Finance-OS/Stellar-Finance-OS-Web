import { useState } from 'react';
import {
  useCreateWalletChallenge,
  type WalletChallenge,
  type WalletChallengePurpose,
} from '@finance-os/api-client';
import { describeWalletError, useWallet, WalletCheckError } from '@finance-os/wallet';

export interface WalletProof {
  challengeId: string;
  signature: string;
}

export type PendingChallenge = WalletChallenge & { address: string };

/**
 * Prove control of a wallet address: fetch a single-use challenge from the API, show its exact
 * message, then have the connected wallet sign it. The backend verifies the signature.
 */
export function useWalletProof(purpose: WalletChallengePurpose) {
  const wallet = useWallet();
  const create = useCreateWalletChallenge();
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  /** Step 1: fetch the message to sign for `address`. Shown to the user before the wallet opens. */
  const start = async (address: string) => {
    setError(null);
    create.reset();
    try {
      const c = await create.mutateAsync({ address, purpose });
      setChallenge({ ...c, address });
    } catch {
      // Shown via `create.error`.
    }
  };

  /** Step 2: open the wallet. Returns the proof, or null if signing failed (see `error`). */
  const sign = async (): Promise<WalletProof | null> => {
    if (!challenge) return null;
    setError(null);
    setSigning(true);
    try {
      const signature = await wallet.signMessage(challenge.message, {
        expectedSigner: challenge.address,
      });
      // The challenge is single-use; the next attempt needs a fresh one.
      setChallenge(null);
      return { challengeId: challenge.challengeId, signature };
    } catch (e) {
      setError(
        e instanceof WalletCheckError && e.reason === 'wrong-account'
          ? `Your wallet is connected to ${wallet.address}. Switch to ${challenge.address} in your wallet, then sign again.`
          : describeWalletError(e),
      );
      return null;
    } finally {
      setSigning(false);
    }
  };

  const cancel = () => {
    setChallenge(null);
    setError(null);
    create.reset();
  };

  return {
    challenge,
    error,
    requestError: create.error,
    isRequesting: create.isPending,
    isSigning: signing,
    start,
    sign,
    cancel,
  };
}
