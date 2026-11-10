import { http, HttpResponse } from 'msw';
import type { WalletChallengeInput } from '../../types';
import { ADMIN_ROLES, authenticate, error, newId, requireRole, type MockContext } from '../context';
import { CHALLENGE_TTL_MS, challengeMessage, isAccountId } from '../wallet-proof';

const PURPOSES = ['link_org_wallet', 'add_treasury_account'];

export const walletChallengeHandlers = ({ db, base }: MockContext) => [
  http.post(`${base}/wallet-challenges`, async ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const { address, purpose } = (await request.json()) as WalletChallengeInput;
    if (!isAccountId(address)) return error(400, 'invalid_address', 'Enter a Stellar G-address.');
    if (!PURPOSES.includes(purpose)) return error(400, 'invalid_purpose', 'Unknown purpose.');
    const org = db.orgs.find((o) => o.id === caller.orgId)!;
    const challengeId = newId('wc');
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    const message = challengeMessage(org.name, address, purpose, nonce, expiresAt);
    db.walletChallenges.push({
      challengeId,
      message,
      expiresAt,
      orgId: org.id,
      address,
      purpose,
      used: false,
    });
    return HttpResponse.json({ challengeId, message, expiresAt }, { status: 201 });
  }),
];
