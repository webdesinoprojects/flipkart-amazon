import "server-only";
import { serverRequest } from "@/features/api/server-request";
import type {
  AdminAuditEvent,
  AdminCustomer,
  AdminCustomerDetail,
  AdminOperations,
  AdminOverview,
  AdminPageResult,
  AdminPayment,
} from "./contracts";

export async function adminOverview(): Promise<AdminOverview | null> {
  return (await serverRequest<AdminOverview>("/api/v1/admin/overview")).data;
}

export async function adminCustomers(
  query = "",
  offset = 0,
): Promise<AdminPageResult<AdminCustomer> | null> {
  const params = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (query) params.set("q", query);
  return (
    await serverRequest<AdminPageResult<AdminCustomer>>(
      `/api/v1/admin/users?${params}`,
    )
  ).data;
}

export async function adminCustomer(
  id: string,
): Promise<AdminCustomerDetail | null> {
  return (
    await serverRequest<AdminCustomerDetail>(
      `/api/v1/admin/users/${encodeURIComponent(id)}`,
    )
  ).data;
}

export async function adminPayments(
  offset = 0,
): Promise<AdminPageResult<AdminPayment> | null> {
  return (
    await serverRequest<AdminPageResult<AdminPayment>>(
      `/api/v1/admin/payments?limit=20&offset=${offset}`,
    )
  ).data;
}

export async function adminOperations(): Promise<AdminOperations | null> {
  return (await serverRequest<AdminOperations>("/api/v1/admin/operations"))
    .data;
}

export async function adminAudit(
  offset = 0,
): Promise<AdminPageResult<AdminAuditEvent> | null> {
  return (
    await serverRequest<AdminPageResult<AdminAuditEvent>>(
      `/api/v1/admin/audit?limit=20&offset=${offset}`,
    )
  ).data;
}
