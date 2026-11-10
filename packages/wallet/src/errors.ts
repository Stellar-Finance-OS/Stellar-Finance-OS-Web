/** The connected wallet can't sign arbitrary messages (SEP-53). */
export class MessageSigningUnsupportedError extends Error {
  constructor() {
    super(
      "This wallet can't sign verification messages. Connect the same account in a wallet that supports message signing (SEP-53), such as Freighter, xBull, Lobstr or Hana, and try again.",
    );
    this.name = 'MessageSigningUnsupportedError';
  }
}

/** Turn wallet-kit / extension errors into plain language for non-crypto users. */
export function describeWalletError(error: unknown): string {
  // PaymentError messages are already plain language; don't re-classify them by keyword.
  if (error instanceof Error && error.name === 'PaymentError') return error.message;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error ?? '');
  if (error instanceof MessageSigningUnsupportedError) return error.message;
  const lower = message.toLowerCase();
  if (/(declin|reject|cancel|denied|closed)/.test(lower)) {
    return 'You cancelled the request in your wallet. Nothing was signed.';
  }
  if (/(not installed|not available|no wallet|unsupported)/.test(lower)) {
    return "We couldn't find that wallet. Make sure it's installed and unlocked.";
  }
  if (/(locked|unlock)/.test(lower)) return 'Unlock your wallet and try again.';
  return message || 'Something went wrong with your wallet. Please try again.';
}
