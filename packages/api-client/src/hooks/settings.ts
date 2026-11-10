import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../context';
import { unwrap } from '../errors';
import type { ApprovalPolicyInput, OrgInput, Role, WalletChallengeInput } from '../types';
import { keys } from './keys';

export function useOrg() {
  const api = useApiClient();
  return useQuery({ queryKey: keys.org, queryFn: async () => unwrap(await api.GET('/org')) });
}

export function useUpdateOrg() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: OrgInput) => unwrap(await api.PATCH('/org', { body })),
    onSuccess: (org) => {
      qc.setQueryData(keys.org, org);
      // Org names also appear in the user's memberships (org switcher).
      return qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useMembers() {
  const api = useApiClient();
  return useQuery({
    queryKey: keys.members,
    queryFn: async () => unwrap(await api.GET('/members')).data,
  });
}

export function useInviteMember() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { email: string; role: Role }) =>
      unwrap(await api.POST('/members', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members }),
  });
}

export function useUpdateMemberRole() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) =>
      unwrap(await api.PATCH('/members/{id}', { params: { path: { id } }, body: { role } })),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.members }),
        qc.invalidateQueries({ queryKey: keys.me }),
      ]),
  });
}

export function useRemoveMember() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response, error } = await api.DELETE('/members/{id}', { params: { path: { id } } });
      unwrap({ data: null, error, response });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members }),
  });
}

export function useApprovalPolicies() {
  const api = useApiClient();
  return useQuery({
    queryKey: keys.approvalPolicies,
    queryFn: async () => unwrap(await api.GET('/approval-policies')).data,
  });
}

export function useCreateApprovalPolicy() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ApprovalPolicyInput) =>
      unwrap(await api.POST('/approval-policies', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.approvalPolicies }),
  });
}

export function useUpdateApprovalPolicy() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: ApprovalPolicyInput & { id: string }) =>
      unwrap(await api.PATCH('/approval-policies/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.approvalPolicies }),
  });
}

export function useDeleteApprovalPolicy() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response, error } = await api.DELETE('/approval-policies/{id}', {
        params: { path: { id } },
      });
      unwrap({ data: null, error, response });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.approvalPolicies }),
  });
}

/** Ask the backend for a single-use message the wallet signs to prove it owns `address`. */
export function useCreateWalletChallenge() {
  const api = useApiClient();
  return useMutation({
    mutationFn: async (body: WalletChallengeInput) =>
      unwrap(await api.POST('/wallet-challenges', { body })),
  });
}
