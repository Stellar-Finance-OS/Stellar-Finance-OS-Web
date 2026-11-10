import { Button } from '@finance-os/ui';
import { PenLine } from 'lucide-react';
import type { PendingChallenge } from './use-wallet-proof';

export interface WalletProofPromptProps {
  challenge: PendingChallenge;
  busy?: boolean;
  onSign: () => void;
  onCancel: () => void;
}

/** Shows the exact message the wallet will sign, before the wallet opens. */
export function WalletProofPrompt({ challenge, busy, onSign, onCancel }: WalletProofPromptProps) {
  return (
    <div className="grid gap-3 rounded-md border p-4" role="region" aria-label="Verify wallet">
      <p className="text-sm">
        To prove you control this wallet, it will ask you to sign exactly this message. Signing does
        not move funds or authorize any payment.
      </p>
      <pre
        aria-label="Message to sign"
        className="bg-muted overflow-x-auto rounded p-3 font-mono text-xs whitespace-pre-wrap break-all"
      >
        {challenge.message}
      </pre>
      <p className="text-muted-foreground text-xs">
        Valid once, until {new Date(challenge.expiresAt).toLocaleString()}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onSign} disabled={busy}>
          <PenLine /> {busy ? 'Waiting for wallet…' : 'Sign with wallet'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
