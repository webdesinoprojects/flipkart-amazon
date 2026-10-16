"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import dashboardStyles from "@/features/dashboard/dashboard.module.css";
import styles from "./cancel-subscription-dialog.module.css";

type UpgradeSubscriptionDialogProps = {
  readonly planName: string;
  readonly priceInr: number;
  readonly addedCredits: number;
  readonly currentCredits: number;
  readonly busy: boolean;
  readonly error: string;
  readonly onConfirm: () => void;
};

export function UpgradeSubscriptionDialog({
  planName,
  priceInr,
  addedCredits,
  currentCredits,
  busy,
  error,
  onConfirm,
}: UpgradeSubscriptionDialogProps) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  function changeOpen(next: boolean) {
    if (busy) return;
    if (next) {
      const dashboardTheme = document
        .querySelector("[data-sidebar][data-theme]")
        ?.getAttribute("data-theme");
      setTheme(dashboardTheme === "dark" ? "dark" : "light");
    }
    setOpen(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <button
          className={dashboardStyles.subscribeAction}
          type="button"
          disabled={busy}
        >
          UPGRADE TO {planName.toUpperCase()}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} data-theme={theme}>
          <span className={styles.eyebrow}>ACCOUNT / PLAN UPGRADE</span>
          <Dialog.Title className={styles.title}>
            Add {planName} capacity?
          </Dialog.Title>
          <Dialog.Description className={styles.description}>
            Razorpay will ask you to authorise the full ₹{priceInr} monthly
            subscription. This is an additional payment, not a prorated charge
            or refund of your current plan. After the new payment is verified,
            your daily limit is {currentCredits.toLocaleString("en-IN")} +{" "}
            {addedCredits.toLocaleString("en-IN")} ={" "}
            {(currentCredits + addedCredits).toLocaleString("en-IN")} credits
            while the paid periods overlap. Renewal on older plans will stop. As
            those paid periods end, their allowances drop away; then {planName}
            alone provides {addedCredits.toLocaleString("en-IN")} credits/day.
            Credits already used today still count.
          </Dialog.Description>
          <p className={styles.note}>
            Nothing is charged until you review and authorise the payment on
            Razorpay.
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button className={styles.keep} type="button" disabled={busy}>
                KEEP CURRENT PLAN
              </button>
            </Dialog.Close>
            <button
              className={styles.upgradeConfirm}
              type="button"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "OPENING..." : "CONTINUE TO RAZORPAY"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
