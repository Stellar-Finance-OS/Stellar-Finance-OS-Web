import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateTreasuryAccount, useTreasuryAccounts } from '@finance-os/api-client';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@finance-os/ui';
import { describeWalletError, useWallet } from '@finance-os/wallet';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { isStellarAccountId } from '@finance-os/utils';
import { usePermission } from '../../auth/use-permission';
import { FormError } from '../../components/forms/form-error';
import { QueryView } from '../../components/query-view';
import { TreasuryCard } from '../../features/dashboard/treasury-card';
import { useWalletProof } from '../../features/wallet-proof/use-wallet-proof';
import { WalletProofPrompt } from '../../features/wallet-proof/wallet-proof-prompt';

const schema = z.object({
  name: z.string().trim().min(1, 'Name the account'),
  address: z.string().trim().refine(isStellarAccountId, 'Enter a Stellar G-address'),
});
type Values = z.infer<typeof schema>;

function AddAccountForm() {
  const create = useCreateTreasuryAccount();
  const wallet = useWallet();
  const proof = useWalletProof('add_treasury_account');
  const [pending, setPending] = useState<Values | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', address: '' } });

  // Step 1: validate, make sure a wallet is connected, then fetch the message to sign.
  const verify = async (values: Values) => {
    setConnectError(null);
    create.reset();
    if (!wallet.address) {
      try {
        await wallet.connect();
      } catch (e) {
        setConnectError(describeWalletError(e));
        return;
      }
    }
    setPending(values);
    await proof.start(values.address);
  };

  // Step 2: sign, then submit the account with the proof.
  const sign = async () => {
    const result = await proof.sign();
    if (!pending || !result) return;
    create.mutate(
      { ...pending, ...result },
      {
        onSuccess: () => {
          reset();
          setPending(null);
        },
      },
    );
  };

  const busy = create.isPending || proof.isRequesting || wallet.status === 'connecting';
  const walletError = connectError ?? proof.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a treasury account</CardTitle>
        <CardDescription>
          Connect the account&apos;s wallet and sign a short message to prove you control it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate className="grid gap-4" onSubmit={handleSubmit(verify)}>
          <FormError error={proof.requestError ?? create.error} />
          {walletError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{walletError}</AlertDescription>
            </Alert>
          ) : null}
          <Field label="Account name" htmlFor="ta-name" error={errors.name?.message}>
            <Input id="ta-name" aria-invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field
            label="Stellar address"
            htmlFor="ta-address"
            hint="Public address only. Finance OS never asks for secret keys."
            error={errors.address?.message}
          >
            <Input
              id="ta-address"
              className="font-mono text-xs"
              aria-invalid={!!errors.address}
              {...register('address')}
            />
          </Field>
          {proof.challenge ? (
            <WalletProofPrompt
              challenge={proof.challenge}
              busy={proof.isSigning || create.isPending}
              onSign={sign}
              onCancel={proof.cancel}
            />
          ) : (
            <div>
              <Button type="submit" disabled={busy}>
                {create.isPending ? 'Adding…' : 'Verify & add account'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function TreasurySettingsPage() {
  const query = useTreasuryAccounts();
  const canManage = usePermission('settings:manage');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <QueryView query={query} resource="treasury accounts">
        {(accounts) => <TreasuryCard accounts={accounts} />}
      </QueryView>
      {canManage ? <AddAccountForm /> : null}
    </div>
  );
}
