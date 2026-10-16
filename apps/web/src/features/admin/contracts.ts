export interface AdminPayment {
  id: string;
  paymentId: string;
  subscriptionId: string;
  userId: string;
  email: string;
  plan: string;
  amountPaise: number;
  paidAt: string;
  periodEnd: string;
  refundedAt: string | null;
}

export interface AdminOverview {
  asOf: string;
  customers: { total: number; paid: number; free: number };
  signups7d: number;
  money: {
    grossCapturedPaise: number;
    fullyRefundedPaise: number;
    netAfterFullRefundsPaise: number;
  };
  labels14d: number;
  billingItemsNeedingReview: number;
  daily: {
    date: string;
    labels: number;
    batches: number;
    capturedPaise: number;
    refundsPaise: number;
  }[];
  recentPayments: AdminPayment[];
}

export interface AdminCustomer {
  id: string;
  email: string;
  status: string;
  emailVerified: boolean;
  plan: string;
  dailyCredits: number;
  usedToday: number;
  bonusCredits: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminSubscription {
  id: string;
  providerId: string;
  plan: string;
  status: string;
  paidThrough: string | null;
  cancelAtCycleEnd: boolean;
  createdAt: string;
}

export interface AdminCustomerDetail extends AdminCustomer {
  savedBatches: number;
  totalLabels: number;
  subscriptions: AdminSubscription[];
  payments: AdminPayment[];
  creditGrants: {
    id: string;
    amount: number;
    remaining: number;
    reason: string;
    expiresAt: string;
    createdAt: string;
  }[];
}

export interface AdminPageResult<T> {
  total: number;
  items: T[];
  limit: number;
  offset: number;
}

export interface AdminOperations {
  asOf: string;
  webhookCounts: Record<string, number>;
  oldestUnresolvedSeconds: number | null;
  events: {
    id: string;
    type: string;
    status: string;
    attempts: number;
    lastError: string | null;
    receivedAt: string;
  }[];
}

export interface AdminAuditEvent {
  id: number;
  event: string;
  outcome: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  requestId: string | null;
  createdAt: string;
}
