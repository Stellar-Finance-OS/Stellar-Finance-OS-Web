import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADDRESSES } from '@finance-os/api-client/mocks';
import { createFakeWalletClient, Keypair, sep53Signer } from '@finance-os/wallet/testing';
import { renderApp } from '../../test/render';
import { db } from '../../test/server';

function realWallet(options: { declined?: boolean } = {}) {
  const kp = Keypair.random();
  const sign = sep53Signer(kp);
  const fake = createFakeWalletClient('testnet', {
    address: kp.publicKey(),
    messageSigner: (m) => (options.declined ? Promise.reject(new Error('User declined')) : sign(m)),
  });
  return { address: kp.publicKey(), ...fake };
}

async function startLink(fake: ReturnType<typeof realWallet>) {
  const user = userEvent.setup();
  renderApp('/settings/wallet', { as: 'owner', walletClient: fake.client });
  await user.click(await screen.findByRole('button', { name: /connect wallet/i }));
  await user.click(await screen.findByRole('button', { name: 'Link this wallet' }));
  return user;
}

describe('wallet ownership proof', () => {
  it('shows the full message before signing, then links the wallet', async () => {
    const fake = realWallet();
    const user = await startLink(fake);
    const message = await screen.findByLabelText('Message to sign');
    expect(message).toHaveTextContent(fake.address);
    expect(message).toHaveTextContent('Acme Studio');
    expect(fake.calls.messages).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /sign with wallet/i }));
    await waitFor(() => expect(db.orgs[0]!.linkedWalletAddress).toBe(fake.address));
    expect(db.walletChallenges[0]!.used).toBe(true);
  });

  it('keeps the old wallet when the user declines', async () => {
    const fake = realWallet({ declined: true });
    const user = await startLink(fake);
    await user.click(await screen.findByRole('button', { name: /sign with wallet/i }));
    expect(await screen.findByText(/cancelled the request/i)).toBeInTheDocument();
    expect(db.orgs[0]!.linkedWalletAddress).toBe(ADDRESSES.operating);
  });

  it('rejects an expired challenge', async () => {
    const fake = realWallet();
    const user = await startLink(fake);
    await screen.findByLabelText('Message to sign');
    db.walletChallenges[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    await user.click(screen.getByRole('button', { name: /sign with wallet/i }));
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
    expect(db.orgs[0]!.linkedWalletAddress).toBe(ADDRESSES.operating);
  });

  it('blocks a treasury account signed by the wrong wallet', async () => {
    const user = userEvent.setup();
    const fake = realWallet();
    const other = Keypair.random().publicKey();
    renderApp('/settings/treasury', { as: 'owner', walletClient: fake.client });
    await user.type(await screen.findByLabelText('Account name'), 'Reserve');
    await user.type(screen.getByLabelText('Stellar address'), other);
    await user.click(screen.getByRole('button', { name: /verify & add account/i }));
    expect(await screen.findByLabelText('Message to sign')).toHaveTextContent(other);
    await user.click(screen.getByRole('button', { name: /sign with wallet/i }));
    expect(await screen.findByText(new RegExp(`Switch to ${other}`))).toBeInTheDocument();
    expect(fake.calls.messages).toHaveLength(0);
    expect(db.treasuryAccounts.some((a) => a.address === other)).toBe(false);
  });

  it('adds a treasury account with a valid signature', async () => {
    const user = userEvent.setup();
    const fake = realWallet();
    renderApp('/settings/treasury', { as: 'owner', walletClient: fake.client });
    await user.type(await screen.findByLabelText('Account name'), 'Reserve');
    await user.type(screen.getByLabelText('Stellar address'), fake.address);
    await user.click(screen.getByRole('button', { name: /verify & add account/i }));
    await user.click(await screen.findByRole('button', { name: /sign with wallet/i }));
    await waitFor(() =>
      expect(db.treasuryAccounts.some((a) => a.address === fake.address)).toBe(true),
    );
  });
});
