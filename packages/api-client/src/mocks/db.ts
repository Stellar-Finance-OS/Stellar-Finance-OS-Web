// In-memory "backend" for MSW. Mirrors what finance-os-backend would return.
// Business rules live here ONLY because this stands in for the server — never copy them into the UI.
import Big from 'big.js';
import type {
  ApprovalPolicy,
  Client,
  InvoiceDetail,
  Member,
  Membership,
  Org,
  PaymentRequest,
  Role,
  Transaction,
  TreasuryAccount,
  User,
  Vendor,
  WalletChallenge,
  WalletChallengePurpose,
} from '../types';
import { ADDRESSES, MUXED, TESTNET_USDC_ISSUER } from './constants';

const DAY = 24 * 3600 * 1000;

export interface MockUser extends User {
  password: string;
  memberships: Membership[];
}

export interface MockDb {
  now: Date;
  users: MockUser[];
  orgs: Org[];
  members: Member[];
  clients: Client[];
  invoices: InvoiceDetail[];
  vendors: Vendor[];
  treasuryAccounts: TreasuryAccount[];
  paymentRequests: PaymentRequest[];
  transactions: Transaction[];
  approvalPolicies: ApprovalPolicy[];
  walletChallenges: MockWalletChallenge[];
  nextInvoiceNumber: number;
}

export interface MockWalletChallenge extends WalletChallenge {
  orgId: string;
  address: string;
  purpose: WalletChallengePurpose;
  used: boolean;
}

export const sum = (values: string[]) => values.reduce((a, v) => a.plus(v), new Big(0)).toFixed(2);

function lineItems(items: [string, string, string][]) {
  return items.map(([description, quantity, unitPrice]) => ({
    description,
    quantity,
    unitPrice,
    total: new Big(quantity).times(unitPrice).toFixed(2),
  }));
}

export function paymentReference(muxId: number) {
  return {
    muxedAddress: MUXED[String(muxId)] ?? MUXED['1012']!,
    address: ADDRESSES.operating,
    memo: String(muxId),
    memoType: 'id' as const,
    assetIssuer: TESTNET_USDC_ISSUER,
  };
}

export interface CreateDbOptions {
  /**
   * Older paid/void invoices added after the seeded ones so lists span several pages.
   * They are closed, so dashboard totals and reconciliation fixtures are unaffected.
   */
  historicInvoices?: number;
}

export function createDb(
  now = new Date(),
  { historicInvoices = 60 }: CreateDbOptions = {},
): MockDb {
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString();
  const role = (r: Role) => r;

  const users: MockUser[] = [
    ['u_ada', 'Ada Okoro', 'ada@acme.test', 'owner'],
    ['u_ben', 'Ben Adeyemi', 'ben@acme.test', 'approver'],
    ['u_chi', 'Chi Nwosu', 'chi@acme.test', 'accountant'],
    ['u_dee', 'Dee Mensah', 'dee@acme.test', 'viewer'],
    ['u_eze', 'Eze Bello', 'eze@acme.test', 'approver'],
  ].map(([id, name, email, r]) => ({
    id: id!,
    name: name!,
    email: email!,
    password: 'password',
    memberships: [{ orgId: 'org_acme', orgName: 'Acme Studio', role: role(r as Role) }],
  }));
  users[0]!.memberships.push({ orgId: 'org_labs', orgName: 'Acme Labs', role: 'admin' });

  const members: Member[] = users.map((u) => ({
    id: `m_${u.id}`,
    userId: u.id,
    name: u.name,
    email: u.email,
    role: u.memberships[0]!.role,
    status: 'active',
  }));

  const clients: Client[] = [
    {
      id: 'c_northwind',
      name: 'Northwind Traders',
      email: 'ap@northwind.test',
      senderAddresses: [ADDRESSES.clientNorthwind],
      createdAt: iso(-90),
    },
    {
      id: 'c_globex',
      name: 'Globex Corporation',
      email: 'payables@globex.test',
      senderAddresses: [ADDRESSES.clientGlobex],
      createdAt: iso(-60),
    },
    {
      id: 'c_initech',
      name: 'Initech',
      email: 'finance@initech.test',
      senderAddresses: [],
      createdAt: iso(-20),
    },
    {
      id: 'c_acme_retail',
      name: 'Acme Retail',
      email: 'ap@acme-retail.test',
      senderAddresses: [],
      createdAt: iso(-400),
    },
  ];

  const invoice = (
    n: number,
    client: Client,
    status: InvoiceDetail['status'],
    issued: number,
    due: number,
    items: [string, string, string][],
    amountPaid = '0.00',
  ): InvoiceDetail => {
    const li = lineItems(items);
    return {
      id: `inv_${n}`,
      number: `INV-${n}`,
      status,
      clientId: client.id,
      clientName: client.name,
      amount: sum(li.map((l) => l.total)),
      amountPaid,
      assetCode: 'USDC',
      issueDate: iso(issued),
      dueDate: iso(due),
      publicToken: `pub_${n}`,
      notes: '',
      lineItems: li,
      payment: paymentReference(n),
      matches: [],
    };
  };

  const [northwind, globex, initech, acmeRetail] = clients as [Client, Client, Client, Client];
  const invoices: InvoiceDetail[] = [
    invoice(1001, northwind, 'sent', -5, 25, [
      ['Brand identity design', '1', '3500.00'],
      ['Revisions (hours)', '6', '125.00'],
    ]),
    invoice(
      1002,
      globex,
      'overdue',
      -35,
      -3,
      [['Website build — milestone 2', '1', '8000.00']],
      '2500.00',
    ),
    invoice(
      1003,
      northwind,
      'paid',
      -40,
      -10,
      [['Monthly retainer — September', '1', '2000.00']],
      '2000.00',
    ),
    invoice(1004, initech, 'draft', 0, 30, [['Discovery workshop', '2', '900.00']]),
    invoice(1005, globex, 'void', -20, 10, [['Duplicate — see INV-1002', '1', '8000.00']]),
    invoice(
      1006,
      initech,
      'partially_paid',
      -12,
      18,
      [['Consulting (hours)', '20', '150.00']],
      '1000.00',
    ),
    invoice(1007, acmeRetail, 'sent', -2, 28, [['Store fit-out drawings', '1', '1200.00']]),
  ];

  // Deterministic history: one closed invoice every ~3 days going back from day -45.
  const historyClients = [northwind, globex, initech, acmeRetail];
  for (let k = 0; k < historicInvoices; k++) {
    const issued = -45 - Math.floor(k * 2.7);
    const isVoid = k % 11 === 10;
    const price = `${((k * 137) % 4000) + 250}.00`;
    const inv = invoice(
      2000 + k,
      historyClients[k % historyClients.length]!,
      isVoid ? 'void' : 'paid',
      issued,
      issued + 30,
      [[`Services — batch ${k + 1}`, '1', price]],
      isVoid ? '0.00' : price,
    );
    invoices.push(inv);
  }

  const transactions: Transaction[] = [
    {
      id: 'tx_1',
      txHash: 'a1'.repeat(32),
      direction: 'incoming',
      amount: '2000.00',
      assetCode: 'USDC',
      from: ADDRESSES.clientNorthwind,
      to: MUXED['1003']!,
      memo: '',
      createdAt: iso(-12),
      matchStatus: 'matched',
      invoiceId: 'inv_1003',
      invoiceNumber: 'INV-1003',
    },
    {
      id: 'tx_2',
      txHash: 'b2'.repeat(32),
      direction: 'incoming',
      amount: '2500.00',
      assetCode: 'USDC',
      from: ADDRESSES.clientGlobex,
      to: ADDRESSES.operating,
      memo: '1002',
      createdAt: iso(-8),
      matchStatus: 'matched',
      invoiceId: 'inv_1002',
      invoiceNumber: 'INV-1002',
    },
    {
      id: 'tx_3',
      txHash: 'c3'.repeat(32),
      direction: 'incoming',
      amount: '1000.00',
      assetCode: 'USDC',
      from: ADDRESSES.unknownSender,
      to: ADDRESSES.operating,
      memo: 'initech hours',
      createdAt: iso(-4),
      matchStatus: 'matched',
      invoiceId: 'inv_1006',
      invoiceNumber: 'INV-1006',
    },
    {
      id: 'tx_4',
      txHash: 'd4'.repeat(32),
      direction: 'incoming',
      amount: '4250.00',
      assetCode: 'USDC',
      from: ADDRESSES.unknownSender,
      to: ADDRESSES.operating,
      memo: '',
      createdAt: iso(-2),
      matchStatus: 'unmatched',
    },
    {
      id: 'tx_5',
      txHash: 'e5'.repeat(32),
      direction: 'incoming',
      amount: '310.00',
      assetCode: 'USDC',
      from: ADDRESSES.clientGlobex,
      to: ADDRESSES.operating,
      memo: 'refund?',
      createdAt: iso(-1),
      matchStatus: 'unmatched',
    },
    {
      id: 'tx_6',
      txHash: 'f6'.repeat(32),
      direction: 'outgoing',
      amount: '1200.00',
      assetCode: 'USDC',
      from: ADDRESSES.operating,
      to: ADDRESSES.vendorCloud,
      memo: 'CLOUD-77',
      createdAt: iso(-6),
      matchStatus: 'matched',
      paymentRequestId: 'pr_3',
    },
  ];

  for (const tx of transactions) {
    const inv = invoices.find((i) => i.id === tx.invoiceId);
    if (inv) {
      inv.matches.push({
        id: `match_${tx.id}`,
        transactionId: tx.id,
        txHash: tx.txHash,
        amount: tx.amount,
        assetCode: tx.assetCode,
        matchedAt: tx.createdAt,
        method: tx.id === 'tx_3' ? 'manual' : 'automatic',
        from: tx.from,
      });
    }
  }

  const vendors: Vendor[] = [
    {
      id: 'v_pixel',
      name: 'Pixel Print Co.',
      email: 'billing@pixel.test',
      payoutAddress: ADDRESSES.vendorPixel,
      createdAt: iso(-80),
    },
    {
      id: 'v_cloud',
      name: 'Nimbus Cloud',
      email: 'accounts@nimbus.test',
      payoutAddress: ADDRESSES.vendorCloud,
      requiredMemo: 'CLOUD-77',
      memoType: 'text',
      createdAt: iso(-70),
    },
    {
      id: 'v_legal',
      name: 'Okafor & Partners (Legal)',
      payoutAddress: ADDRESSES.vendorLegal,
      requiredMemo: '88213',
      memoType: 'id',
      createdAt: iso(-30),
    },
  ];

  const treasuryAccounts: TreasuryAccount[] = [
    {
      id: 'ta_operating',
      name: 'Operating',
      address: ADDRESSES.operating,
      balances: [
        { assetCode: 'USDC', amount: '48250.75' },
        { assetCode: 'XLM', amount: '152.4000000' },
      ],
    },
    {
      id: 'ta_payroll',
      name: 'Payroll reserve',
      address: ADDRESSES.payroll,
      balances: [
        { assetCode: 'USDC', amount: '20000.00' },
        { assetCode: 'XLM', amount: '25.0000000' },
      ],
    },
  ];

  const pr = (
    id: string,
    vendor: Vendor,
    amount: string,
    status: PaymentRequest['status'],
    approvals: PaymentRequest['approvals'],
    extra: Partial<PaymentRequest> = {},
  ): PaymentRequest => ({
    id,
    status,
    vendorId: vendor.id,
    vendorName: vendor.name,
    destination: vendor.payoutAddress,
    amount,
    assetCode: 'USDC',
    memo: vendor.requiredMemo,
    memoType: vendor.memoType,
    description: '',
    treasuryAccountId: 'ta_operating',
    treasuryAddress: ADDRESSES.operating,
    requiredApprovals: new Big(amount).gte(5000) ? 2 : 1,
    approvals,
    createdByName: 'Chi Nwosu',
    createdAt: iso(-3),
    canApprove: false,
    canSubmit: false,
    ...extra,
  });
  const [pixel, cloud, legal] = vendors as [Vendor, Vendor, Vendor];
  const paymentRequests: PaymentRequest[] = [
    pr(
      'pr_1',
      legal,
      '6500.00',
      'pending_approval',
      [
        {
          userId: 'u_ben',
          userName: 'Ben Adeyemi',
          decision: 'approved',
          comment: 'Matches the engagement letter.',
          decidedAt: iso(-1),
        },
      ],
      { description: 'Q4 contract review' },
    ),
    pr(
      'pr_2',
      pixel,
      '850.00',
      'approved',
      [{ userId: 'u_ben', userName: 'Ben Adeyemi', decision: 'approved', decidedAt: iso(-1) }],
      { description: 'Business cards & brochures' },
    ),
    pr(
      'pr_3',
      cloud,
      '1200.00',
      'settled',
      [{ userId: 'u_eze', userName: 'Eze Bello', decision: 'approved', decidedAt: iso(-7) }],
      { description: 'Hosting — October', txHash: 'f6'.repeat(32), createdAt: iso(-8) },
    ),
    pr('pr_4', pixel, '300.00', 'pending_approval', [], { description: 'Signage proofs' }),
    pr(
      'pr_5',
      cloud,
      '99.00',
      'rejected',
      [
        {
          userId: 'u_eze',
          userName: 'Eze Bello',
          decision: 'rejected',
          comment: 'Duplicate of October invoice.',
          decidedAt: iso(-2),
        },
      ],
      { description: 'Hosting add-on' },
    ),
  ];

  const approvalPolicies: ApprovalPolicy[] = [
    {
      id: 'ap_default',
      name: 'Standard payments',
      assetCode: 'USDC',
      minAmount: '0.00',
      requiredApprovals: 1,
      approverRoles: ['owner', 'admin', 'approver'],
    },
    {
      id: 'ap_large',
      name: 'Large payments',
      assetCode: 'USDC',
      minAmount: '5000.00',
      requiredApprovals: 2,
      approverRoles: ['owner', 'admin', 'approver'],
    },
  ];

  const orgs: Org[] = [
    {
      id: 'org_acme',
      name: 'Acme Studio',
      legalName: 'Acme Studio Ltd.',
      defaultAssetCode: 'USDC',
      linkedWalletAddress: ADDRESSES.operating,
    },
    { id: 'org_labs', name: 'Acme Labs', legalName: 'Acme Labs Ltd.', defaultAssetCode: 'USDC' },
  ];

  return {
    now,
    users,
    orgs,
    members,
    clients,
    invoices,
    vendors,
    treasuryAccounts,
    paymentRequests,
    transactions,
    approvalPolicies,
    walletChallenges: [],
    nextInvoiceNumber: 1007,
    nextInvoiceNumber: 1008,
  };
}
