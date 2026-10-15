"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import dashboardStyles from "@/features/dashboard/dashboard.module.css";
import styles from "./cancel-subscription-dialog.module.css";

type CancelSubscriptionDialogProps = {
  readonly kind: "checkout" | "renewal";
  readonly hasPaidPeriod: boolean;
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
};

export function CancelSubscriptionDialog({
  kind,
  hasPaidPeriod,
  open,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: CancelSubscriptionDialogProps) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const isRenewal = kind === "renewal";

  function changeOpen(next: boolean) {
    if (busy) return;
    if (next) {
      const dashboardTheme = document
        .querySelector("[data-sidebar][data-theme]")
        ?.getAttribute("data-theme");
      setTheme(dashboardTheme === "dark" ? "dark" : "light");
    }
    onOpenChange(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <button
          className={dashboardStyles.secondaryAction}
          type="button"
          disabled={busy}
        >
          {isRenewal ? "CANCEL RENEWAL" : "CANCEL OPEN CHECKOUT"}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} data-theme={theme}>
          <span className={styles.eyebrow}>ACCOUNT / SUBSCRIPTION</span>
          <Dialog.Title className={styles.title}>
            {isRenewal ? "Stop automatic renewal?" : "Cancel this checkout?"}
          </Dialog.Title>
          <Dialog.Description className={styles.description}>
            {isRenewal
              ? hasPaidPeriod
                ? "Your paid credits remain available until the current paid period ends. Future monthly charges will stop."
                : "We will check the payment state with Razorpay before changing your subscription."
              : "Only cancel if you have not paid. If you completed a payment, keep this checkout open while we confirm it."}
          </Dialog.Description>
          <p className={styles.note}>Nothing changes until you confirm.</p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button className={styles.keep} type="button" disabled={busy}>
                {isRenewal ? "KEEP RENEWAL" : "KEEP CHECKOUT"}
              </button>
            </Dialog.Close>
            <button
              className={styles.confirm}
              type="button"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy
                ? "CHECKING..."
                : isRenewal
                  ? "STOP RENEWAL"
                  : "CANCEL CHECKOUT"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
