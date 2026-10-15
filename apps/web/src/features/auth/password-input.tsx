"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import styles from "./auth.module.css";

export function PasswordInput({
  autoComplete,
}: {
  readonly autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={styles.passwordField}>
      <input
        name="password"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={4}
        maxLength={1024}
      />
      <button
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className={styles.passwordToggle}
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? (
          <EyeOff aria-hidden="true" size={19} strokeWidth={1.8} />
        ) : (
          <Eye aria-hidden="true" size={19} strokeWidth={1.8} />
        )}
      </button>
    </div>
  );
}
