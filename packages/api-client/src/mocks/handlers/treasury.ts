import { http, HttpResponse } from 'msw';
import type { TreasuryAccountInput } from '../../types';
import { ADMIN_ROLES, authenticate, newId, requireRole, type MockContext } from '../context';
import { verifyWalletProof } from '../wallet-proof';

export const treasuryHandlers = ({ db, base }: MockContext) => [
  http.get(`${base}/treasury-accounts`, ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: db.treasuryAccounts });
  }),

  http.post(`${base}/treasury-accounts`, async ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const { challengeId, signature, ...input } = (await request.json()) as TreasuryAccountInput;
    const invalid = await verifyWalletProof(
      db,
      { orgId: caller.orgId, address: input.address, purpose: 'add_treasury_account' },
      { challengeId, signature },
    );
    if (invalid) return invalid;
    const account = { id: newId('ta'), ...input, balances: [] };
    db.treasuryAccounts.push(account);
    return HttpResponse.json(account, { status: 201 });
  }),
];
