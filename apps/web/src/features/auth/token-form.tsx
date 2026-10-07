"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authApi, AuthApiError } from "./browser-api";
import styles from "./auth.module.css";

export function TokenForm({
  mode,
  token,
}: {
  mode: "verify" | "reset";
  token: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (!token)
        throw new AuthApiError("This link is incomplete or invalid.", 400);
      if (mode === "verify") {
        await authApi.verifyEmail(token);
        setMessage("Email verified. You can now sign in.");
      } else {
        const password = String(
          new FormData(event.currentTarget).get("password") ?? "",
        );
        await authApi.resetPassword(token, password);
        setMessage(
          "Password updated. Every previous session has been signed out.",
        );
        event.currentTarget.reset();
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
    <form className={styles.form} onSubmit={submit}>
      {mode === "reset" && (
        <label>
          <span>NEW PASSWORD</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
      )}
      <button type="submit" disabled={pending || Boolean(message)}>
        {pending
          ? "CHECKING…"
          : mode === "verify"
            ? "VERIFY EMAIL"
            : "UPDATE PASSWORD"}
      </button>
      <div className={error ? styles.error : styles.message} aria-live="polite">
        {error || message}
      </div>
      {message && (
        <Link className={styles.inlineLink} href="/login">
          CONTINUE TO SIGN IN →
        </Link>
      )}
    </form>
  );
}
