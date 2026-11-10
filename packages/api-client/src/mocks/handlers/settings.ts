import { http, HttpResponse } from 'msw';
import type { ApprovalPolicyInput, OrgInput, Role } from '../../types';
import { ADMIN_ROLES, authenticate, error, newId, requireRole, type MockContext } from '../context';
import { verifyWalletProof } from '../wallet-proof';

export const settingsHandlers = ({ db, base }: MockContext) => [
  http.get(`${base}/org`, ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const org = db.orgs.find((o) => o.id === caller.orgId);
    return org ? HttpResponse.json(org) : error(404, 'not_found', 'Organization not found.');
  }),

  http.patch(`${base}/org`, async ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const org = db.orgs.find((o) => o.id === caller.orgId)!;
    const { challengeId, signature, ...input } = (await request.json()) as OrgInput;
    if (
      input.linkedWalletAddress !== undefined &&
      input.linkedWalletAddress !== org.linkedWalletAddress
    ) {
      const invalid = await verifyWalletProof(
        db,
        { orgId: org.id, address: input.linkedWalletAddress, purpose: 'link_org_wallet' },
        { challengeId, signature },
      );
      if (invalid) return invalid;
    }
    Object.assign(org, input);
    for (const u of db.users)
      for (const m of u.memberships) if (m.orgId === org.id) m.orgName = org.name;
    return HttpResponse.json(org);
  }),

  http.get(`${base}/members`, ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: db.members });
  }),

  http.post(`${base}/members`, async ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const { email, role } = (await request.json()) as { email: string; role: Role };
    if (db.members.some((m) => m.email === email))
      return error(409, 'exists', 'This person is already a member.');
    const member = {
      id: newId('m'),
      userId: '',
      name: email.split('@')[0]!,
      email,
      role,
      status: 'invited' as const,
    };
    db.members.push(member);
    return HttpResponse.json(member, { status: 201 });
  }),

  http.patch(`${base}/members/:id`, async ({ request, params }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const member = db.members.find((m) => m.id === params.id);
    if (!member) return error(404, 'not_found', 'Member not found.');
    const { role } = (await request.json()) as { role: Role };
    if (
      member.role === 'owner' &&
      db.members.filter((m) => m.role === 'owner').length === 1 &&
      role !== 'owner'
    ) {
      return error(409, 'last_owner', 'An organization needs at least one owner.');
    }
    member.role = role;
    const user = db.users.find((u) => u.id === member.userId);
    const membership = user?.memberships.find((m) => m.orgId === caller.orgId);
    if (membership) membership.role = role;
    return HttpResponse.json(member);
  }),

  http.delete(`${base}/members/:id`, ({ request, params }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const index = db.members.findIndex((m) => m.id === params.id);
    if (index < 0) return error(404, 'not_found', 'Member not found.');
    if (db.members[index]!.userId === caller.user.id)
      return error(409, 'self', "You can't remove yourself.");
    db.members.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${base}/approval-policies`, ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: db.approvalPolicies });
  }),

  http.post(`${base}/approval-policies`, async ({ request }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const policy = { id: newId('ap'), ...((await request.json()) as ApprovalPolicyInput) };
    db.approvalPolicies.push(policy);
    return HttpResponse.json(policy, { status: 201 });
  }),

  http.patch(`${base}/approval-policies/:id`, async ({ request, params }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const policy = db.approvalPolicies.find((p) => p.id === params.id);
    if (!policy) return error(404, 'not_found', 'Policy not found.');
    Object.assign(policy, (await request.json()) as ApprovalPolicyInput);
    return HttpResponse.json(policy);
  }),

  http.delete(`${base}/approval-policies/:id`, ({ request, params }) => {
    const caller = authenticate(db, request);
    if (caller instanceof Response) return caller;
    const denied = requireRole(caller, ADMIN_ROLES);
    if (denied) return denied;
    const index = db.approvalPolicies.findIndex((p) => p.id === params.id);
    if (index < 0) return error(404, 'not_found', 'Policy not found.');
    db.approvalPolicies.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
