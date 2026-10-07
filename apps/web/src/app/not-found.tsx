import Link from "next/link";
import status from "@/features/marketing/status.module.css";

export default function NotFound() {
  return (
    <main className={status.statusPage}>
      <span className={status.kicker}>404 / PAGE NOT FOUND</span>
      <h1>NOTHING AT THIS ADDRESS.</h1>
      <p>
        The page may have moved. You can return home or open the label
        workspace.
      </p>
      <div className={status.actions}>
        <Link className={status.primaryAction} href="/">
          BACK TO HOME ↗
        </Link>
        <Link className={status.secondaryAction} href="/app">
          OPEN THE APP
        </Link>
      </div>
    </main>
  );
}
