// Server-side wallet ownership check for the mock backend (mirrors finance-os-backend).
// The UI never verifies signatures itself — it just shows the API's error.
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import type { WalletChallengePurpose } from '../types';
import { error } from './context';
import type { MockDb } from './db';

type Bytes = Parameters<Keypair['verify']>[0];

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const NETWORK = 'Stellar Testnet';

/** SEP-53: sha256("Stellar Signed Message:\n" + message). */
export async function sep53Digest(message: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`Stellar Signed Message:\n${message}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function challengeMessage(
  orgName: string,
  address: string,
  purpose: WalletChallengePurpose,
  nonce: string,
  expiresAt: string,
) {
  const action =
    purpose === 'link_org_wallet'
      ? `link this wallet to ${orgName}`
      : `add this wallet as a treasury account of ${orgName}`;
  return [
    `Finance OS wallet verification`,
    ``,
    `I confirm I control ${address} and want to ${action}.`,
    ``,
    `Organization: ${orgName}`,
    `Network: ${NETWORK}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`,
    ``,
    `Signing this message does not move funds or authorize any payment.`,
  ].join('\n');
}

/**
 * Consume a challenge: single-use, unexpired, for this org/address/purpose, and signed
 * by `address`. Returns an error Response, or null when the proof is valid.
 */
export async function verifyWalletProof(
  db: MockDb,
  input: { orgId: string; address: string; purpose: WalletChallengePurpose },
  proof: { challengeId?: string; signature?: string },
): Promise<Response | null> {
  if (!proof.challengeId || !proof.signature) {
    return error(
      400,
      'wallet_proof_required',
      'Sign the verification message with this wallet to prove you control it.',
    );
  }
  const challenge = db.walletChallenges.find((c) => c.challengeId === proof.challengeId);
  if (!challenge || challenge.orgId !== input.orgId || challenge.purpose !== input.purpose) {
    return error(400, 'challenge_invalid', 'This verification request is not valid. Start again.');
  }
  if (challenge.used) {
    return error(409, 'challenge_used', 'This verification message was already used. Start again.');
  }
  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    return error(
      410,
      'challenge_expired',
      'The verification message expired. Start again and sign within 5 minutes.',
    );
  }
  if (challenge.address !== input.address) {
    return error(
      400,
      'challenge_address_mismatch',
      'The signed message was for a different wallet address.',
    );
  }
  // Burn it before checking the signature so a bad attempt can't be retried.
  challenge.used = true;
  const signature = base64ToBytes(proof.signature);
  const digest = await sep53Digest(challenge.message);
  let valid: boolean;
  try {
    valid =
      !!signature &&
      Keypair.fromPublicKey(input.address).verify(digest as Bytes, signature as Bytes);
  } catch {
    valid = false;
  }
  return valid
    ? null
    : error(
        400,
        'signature_invalid',
        "The signature doesn't match this wallet. Make sure you signed with the account you're linking.",
      );
}

export function isAccountId(address: unknown): address is string {
  return typeof address === 'string' && StrKey.isValidEd25519PublicKey(address);
}
