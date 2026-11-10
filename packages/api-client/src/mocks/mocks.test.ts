import Big from 'big.js';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { unwrap } from '../errors';
import { createDb, createHandlers, type MockDb } from './index';

const baseUrl = 'http://api.test/v1';
let db: MockDb;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  db = createDb();
  server.resetHandlers(...createHandlers({ baseUrl, db }));
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function as(email: string) {
  const anon = createApiClient({ baseUrl });
  const session = unwrap(await anon.POST('/auth/login', { body: { email, password: 'password' } }));
  return createApiClient({ baseUrl, getToken: () => session.token });
}

describe('mock backend', () => {
  it('rejects bad credentials and unauthenticated calls', async () => {
    const anon = createApiClient({ baseUrl });
    const login = await anon.POST('/auth/login', {
      body: { email: 'ada@acme.test', password: 'x' },
    });
    expect(login.response.status).toBe(401);
    const me = await anon.GET('/me');
    expect(me.response.status).toBe(401);
  });

  it('creates and sends an invoice', async () => {
    const api = await as('chi@acme.test');
    const created = unwrap(
      await api.POST('/invoices', {
        body: {
          clientId: 'c_initech',
          assetCode: 'USDC',
          dueDate: new Date().toISOString(),
          lineItems: [{ description: 'Work', quantity: '3', unitPrice: '100.10' }],
        },
      }),
    );
    expect(created).toMatchObject({ status: 'draft', amount: '300.30' });
    const sent = unwrap(
      await api.POST('/invoices/{id}/send', { params: { path: { id: created.id } } }),
    );
    expect(sent.status).toBe('sent');
  });

  it('forbids viewers from writing', async () => {
    const api = await as('dee@acme.test');
    const res = await api.POST('/clients', { body: { name: 'X', email: 'x@x.test' } });
    expect(res.response.status).toBe(403);
  });

  it('needs two approvals for large payments', async () => {
    const ben = await as('ben@acme.test');
    const eze = await as('eze@acme.test');
    // pr_1 (6,500 USDC) already has Ben's approval.
    expect(unwrap(await ben.GET('/approvals')).data.map((p) => p.id)).not.toContain('pr_1');
    const after = unwrap(
      await eze.POST('/payment-requests/{id}/approve', {
        params: { path: { id: 'pr_1' } },
        body: {},
      }),
    );
    expect(after.status).toBe('approved');
  });

  it('builds an unsigned transaction for an approved request', async () => {
    const chi = await as('chi@acme.test');
    const built = unwrap(
      await chi.POST('/payment-requests/{id}/build-tx', { params: { path: { id: 'pr_2' } } }),
    );
    expect(built.xdr).toMatch(/^AAAA/);
    expect(built.summary).toMatchObject({ amount: '850.00', assetCode: 'USDC' });
  });

  it('manually matches an unmatched payment to an invoice', async () => {
    const chi = await as('chi@acme.test');
    unwrap(
      await chi.POST('/transactions/{id}/match', {
        params: { path: { id: 'tx_4' } },
        body: { invoiceId: 'inv_1001' },
      }),
    );
    const invoice = unwrap(
      await chi.GET('/invoices/{id}', { params: { path: { id: 'inv_1001' } } }),
    );
    expect(invoice.status).toBe('paid');
    expect(invoice.matches).toHaveLength(1);
  });

  it('paginates, sorts and searches invoices on the server', async () => {
    db = createDb(new Date(), { historicInvoices: 493 }); // 7 seeded + 493 = 500
    server.resetHandlers(...createHandlers({ baseUrl, db }));
    const chi = await as('chi@acme.test');

    const first = unwrap(await chi.GET('/invoices', { params: { query: { limit: 50 } } }));
    expect(first.data).toHaveLength(50);
    expect(first.total).toBe(500);
    expect(first.nextCursor).toBeTruthy();

    // Sort is applied before paging, so the order holds across pages.
    const amounts: string[] = [];
    let cursor: string | undefined;
    do {
      const page = unwrap(
        await chi.GET('/invoices', {
          params: { query: { sort: 'amount:asc', limit: 100, cursor } },
        }),
      );
      amounts.push(...page.data.map((i) => i.amount));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(amounts).toHaveLength(500);
    const sorted = [...amounts].sort((a, b) => new Big(a).cmp(new Big(b)));
    expect(amounts).toEqual(sorted);

    const acme = unwrap(
      await chi.GET('/invoices', { params: { query: { q: 'acme', limit: 100 } } }),
    );
    expect(acme.total).toBeGreaterThan(0);
    expect(acme.data.every((i) => i.clientName === 'Acme Retail')).toBe(true);

    const open = unwrap(
      await chi.GET('/invoices', {
        params: { query: { q: 'acme', status: ['sent', 'overdue', 'partially_paid'] } },
      }),
    );
    expect(open.data.map((i) => i.number)).toEqual(['INV-1007']);
  });

  it('exports CSV for a date range', async () => {
    const chi = await as('chi@acme.test');
    const { data } = await chi.GET('/exports/reconciliation', {
      params: { query: { from: '2000-01-01', to: '2100-01-01' } },
      parseAs: 'text',
    });
    expect(data?.split('\n')[0]).toBe(
      'date,direction,amount,asset,from,to,memo,status,invoice,payment_request,tx_hash',
    );
  });
});

describe('wallet ownership proof', () => {
  it('rejects unsigned links, bad signatures and reused challenges', async () => {
    const { Keypair } = await import('@stellar/stellar-sdk');
    const { sep53Digest } = await import('./index');
    const api = await as('ada@acme.test');
    const kp = Keypair.random();
    const address = kp.publicKey();

    const unsigned = await api.PATCH('/org', { body: { linkedWalletAddress: address } });
    expect(unsigned.error?.code).toBe('wallet_proof_required');

    const challenge = async () =>
      unwrap(
        await api.POST('/wallet-challenges', { body: { address, purpose: 'link_org_wallet' } }),
      );
    type Bytes = Parameters<typeof kp.sign>[0];
    const signWith = async (signer: typeof kp, message: string) =>
      btoa(String.fromCharCode(...signer.sign((await sep53Digest(message)) as Bytes)));
    const sign = (message: string) => signWith(kp, message);

    const bad = await challenge();
    const forged = await signWith(Keypair.random(), bad.message);
    const rejected = await api.PATCH('/org', {
      body: {
        linkedWalletAddress: address,
        challengeId: bad.challengeId,
        signature: forged,
      },
    });
    expect(rejected.error?.code).toBe('signature_invalid');

    const good = await challenge();
    const body = {
      linkedWalletAddress: address,
      challengeId: good.challengeId,
      signature: await sign(good.message),
    };
    expect(unwrap(await api.PATCH('/org', { body })).linkedWalletAddress).toBe(address);
    db.orgs[0]!.linkedWalletAddress = 'GOLD';
    expect((await api.PATCH('/org', { body })).error?.code).toBe('challenge_used');
  });
});
