"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Gift, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApiRequest } from "@/features/auth/browser-api";
import styles from "./admin.module.css";

type GrantRequest = {
  requestId: string;
  amount: number;
  reason: string;
  expiresAt: string;
};

export function CreditGrantDialog({
  customerId,
  email,
}: {
  customerId: string;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<GrantRequest | null>(null);

  function resetAttempt() {
    setAttempt(null);
    setError("");
  }

  async function submit() {
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 10_000 ||
      reason.trim().length < 8
    ) {
      setError("Enter 1–10,000 credits and a reason of at least 8 characters.");
      return;
    }
    const payload = attempt ?? {
      requestId: crypto.randomUUID(),
      amount,
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    };
    setAttempt(payload);
    setPending(true);
    setError("");
    try {
      await browserApiRequest(
        `/api/v1/admin/users/${encodeURIComponent(customerId)}/credit-grants`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        true,
      );
      setOpen(false);
      setReason("");
      setAttempt(null);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Grant failed. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button className={styles.buttonLink} type="button">
          <Gift size={15} aria-hidden="true" /> Grant credits
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogPanel}>
          <div className={styles.dialogTop}>
            <span className={styles.eyebrow}>ADMIN / CREDIT GRANT</span>
            <Dialog.Close
              className={styles.dialogClose}
              aria-label="Close credit grant"
              disabled={pending}
            >
              <X size={19} />
            </Dialog.Close>
          </div>
          <Dialog.Title>Grant one-time credits</Dialog.Title>
          <Dialog.Description>
            Extra labels for {email}. This pool is spent after daily plan
            credits, never refreshes, and expires automatically. This action is
            audited.
          </Dialog.Description>
          <label className={styles.formLabel} htmlFor="grant-amount">
            Number of credits
          </label>
          <input
            id="grant-amount"
            className={styles.formInput}
            type="number"
            min={1}
            max={10000}
            step={1}
            value={amount}
            onChange={(event) => {
              setAmount(Number(event.target.value));
              resetAttempt();
            }}
          />
          <label className={styles.formLabel} htmlFor="grant-reason">
            Reason for this grant
          </label>
          <textarea
            id="grant-reason"
            className={styles.formInput}
            maxLength={200}
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              resetAttempt();
            }}
            placeholder="For example, support adjustment for a failed batch"
          />
          <span className={styles.formLabel}>Expires after</span>
          <div
            className={styles.choiceRow}
            role="group"
            aria-label="Credit expiry"
          >
            {[7, 30, 90].map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={days === option}
                className={`${styles.choice} ${days === option ? styles.choiceActive : ""}`}
                onClick={() => {
                  setDays(option);
                  resetAttempt();
                }}
              >
                {option} days
              </button>
            ))}
          </div>
          {error && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.dialogActions}>
            <Dialog.Close className={styles.pageButton} disabled={pending}>
              Keep unchanged
            </Dialog.Close>
            <button
              className={styles.buttonLink}
              type="button"
              disabled={pending}
              onClick={submit}
            >
              {pending ? "Granting…" : `Grant ${amount || 0} credits`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
