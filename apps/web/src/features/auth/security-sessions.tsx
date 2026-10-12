"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountSession } from "./contracts";
import { authApi, AuthApiError } from "./browser-api";
import styles from "@/features/dashboard/dashboard.module.css";

function readableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SecuritySessions() {
  const router = useRouter();
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [message, setMessage] = useState("Loading active sessions…");
  const load = useCallback(async () => {
    try {
      setSessions(await authApi.sessions());
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof AuthApiError
          ? error.message
          : "Could not load sessions.",
      );
    }
  }, []);
  useEffect(() => {
    let active = true;
    authApi.sessions().then(
      (items) => {
        if (active) {
          setSessions(items);
          setMessage("");
        }
      },
      (error: unknown) => {
        if (active) {
          setMessage(
            error instanceof AuthApiError
              ? error.message
              : "Could not load sessions.",
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function revoke(session: AccountSession) {
    setMessage("Revoking session…");
    try {
      await authApi.revokeSession(session.id);
      if (session.current) {
        router.replace("/login");
        router.refresh();
        return;
      }
      await load();
    } catch (error) {
      setMessage(
        error instanceof AuthApiError
          ? error.message
          : "Could not revoke session.",
      );
    }
  }

  return (
    <>
      <p className={styles.status} aria-live="polite">
        {message}
      </p>
      <div className={styles.sessions} aria-label="Active account sessions">
        {sessions.map((session) => (
          <article className={styles.session} key={session.id}>
            <strong>
              {session.deviceSummary}
              {session.current ? " / THIS DEVICE" : ""}
            </strong>
            <span>
              LAST SEEN
              <br />
              {readableDate(session.lastSeenAt)}
            </span>
            <span>
              EXPIRES
              <br />
              {readableDate(session.expiresAt)}
            </span>
            <button type="button" onClick={() => void revoke(session)}>
              {session.current ? "SIGN OUT" : "REVOKE"}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
