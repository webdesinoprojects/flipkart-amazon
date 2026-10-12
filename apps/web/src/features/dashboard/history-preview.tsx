"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Download, Eye, X } from "lucide-react";
import styles from "./dashboard.module.css";

export function HistoryActions({
  batchLabel,
  downloadUrl,
  filename,
  previewUrl,
}: {
  readonly batchLabel: string;
  readonly downloadUrl: string;
  readonly filename: string;
  readonly previewUrl: string;
}) {
  return (
    <div className={styles.historyActions}>
      <Dialog.Root>
        <Dialog.Trigger className={styles.historyPreviewTrigger}>
          <Eye aria-hidden="true" size={13} strokeWidth={1.8} /> PREVIEW
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.previewOverlay} />
          <Dialog.Content className={styles.previewDrawer}>
            <header className={styles.previewDrawerHeader}>
              <div>
                <span className={styles.previewDrawerEyebrow}>
                  SAVED OUTPUT / PDF PREVIEW
                </span>
                <Dialog.Title>{filename}</Dialog.Title>
                <Dialog.Description>{batchLabel}</Dialog.Description>
              </div>
              <div className={styles.previewDrawerActions}>
                <a href={downloadUrl}>
                  <Download aria-hidden="true" size={14} /> DOWNLOAD
                </a>
                <Dialog.Close aria-label="Close PDF preview">
                  <X aria-hidden="true" size={18} />
                </Dialog.Close>
              </div>
            </header>
            <div className={styles.previewDrawerBody}>
              <iframe
                src={previewUrl}
                title={`PDF preview for ${batchLabel}`}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <a className={styles.historyDownload} href={downloadUrl}>
        <Download aria-hidden="true" size={13} strokeWidth={1.8} /> DOWNLOAD
      </a>
    </div>
  );
}
