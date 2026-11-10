// MSW mocks for local development and tests. Never imported by production code paths.
import { createDb, type MockDb } from './db';
import type { MockContext } from './context';
import { authHandlers } from './handlers/auth';
import { clientHandlers } from './handlers/clients';
import { invoiceHandlers } from './handlers/invoices';
import { paymentRequestHandlers } from './handlers/payment-requests';
import { reportHandlers } from './handlers/reports';
import { settingsHandlers } from './handlers/settings';
import { transactionHandlers } from './handlers/transactions';
import { treasuryHandlers } from './handlers/treasury';
import { vendorHandlers } from './handlers/vendors';
import { walletChallengeHandlers } from './handlers/wallet-challenges';

export { createDb, type CreateDbOptions, type MockDb } from './db';
export { ADDRESSES, MUXED, TESTNET_USDC_ISSUER } from './constants';
export { TOKEN_PREFIX } from './context';
export { CHALLENGE_TTL_MS, sep53Digest } from './wallet-proof';
export { DEFAULT_LIMIT, MAX_LIMIT } from './list';
export { SETTLE_DELAY_MS } from './handlers/payment-requests';

export interface CreateHandlersOptions {
  /** API base URL the app is configured with (VITE_API_URL). */
  baseUrl: string;
  /** Provide a db to inspect or mutate it from tests. */
  db?: MockDb;
}

export function createHandlers({ baseUrl, db = createDb() }: CreateHandlersOptions) {
  const ctx: MockContext = { db, base: baseUrl.replace(/\/+$/, '') };
  return [
    ...authHandlers(ctx),
    ...clientHandlers(ctx),
    ...invoiceHandlers(ctx),
    ...vendorHandlers(ctx),
    ...treasuryHandlers(ctx),
    ...paymentRequestHandlers(ctx),
    ...transactionHandlers(ctx),
    ...reportHandlers(ctx),
    ...settingsHandlers(ctx),
    ...walletChallengeHandlers(ctx),
  ];
}
