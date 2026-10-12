"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi, AuthApiError } from "./browser-api";
import { safeReturnTarget } from "./return-target";
import styles from "./auth.module.css";

type Mode = "login" | "register" | "forgot";

const copy = {
  login: { submit: "SIGN IN", pending: "SIGNING IN…" },
  register: { submit: "CREATE ACCOUNT", pending: "CREATING ACCOUNT…" },
  forgot: { submit: "SEND RESET LINK", pending: "SENDING…" },
} as const;

export function AuthForm({
  mode,
  returnTo,
}: {
  mode: Mode;
  returnTo?: string | undefined;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError("");
    setMessage("");
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "login") {
        await authApi.login(email, password);
        router.replace(safeReturnTarget(returnTo));
        router.refresh();
      } else if (mode === "register") {
        const result = await authApi.register(email, password);
        setMessage(result.message);
        formElement.reset();
      } else {
        const result = await authApi.forgotPassword(email);
        setMessage(result.message);
        formElement.reset();
      }
    } catch (caught) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The account service is unavailable. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <label>
        <span>EMAIL ADDRESS</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
        />
      </label>
      {mode !== "forgot" && (
        <label>
          <span>PASSWORD</span>
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            required
            minLength={10}
            maxLength={1024}
          />
          {mode === "register" && (
            <small>10+ characters. Long passphrases are welcome.</small>
          )}
        </label>
      )}
      {mode === "login" && (
        <Link className={styles.inlineLink} href="/forgot-password">
          FORGOT PASSWORD?
        </Link>
      )}
      <button type="submit" disabled={pending}>
        {pending ? copy[mode].pending : copy[mode].submit}
      </button>
      <div className={error ? styles.error : styles.message} aria-live="polite">
        {error || message}
      </div>
    </form>
  );
}
