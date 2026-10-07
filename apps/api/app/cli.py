"""Operator command line. Not reachable over HTTP.

The first administrator is created here and nowhere else. There is no public
route, no environment variable, and no seeded default account that can grant the
``admin`` role, so a misconfigured deployment cannot ship with a known admin
password.

    docker compose exec api python -m app.cli create-admin --email owner@example.com

The password is read from a hidden interactive prompt, or from a file whose path
is given with ``--password-file``. It is never accepted as a command argument,
so it cannot reach shell history, the process table, or a committed env file.
"""

from __future__ import annotations

import argparse
import sys
from getpass import getpass
from pathlib import Path

from .config import get_settings
from .database import SessionLocal
from .modules.audit import service as audit
from .modules.auth.email_address import InvalidEmailError, normalize_email
from .modules.auth.models import UserRecord
from .modules.auth.passwords import PasswordPolicyError, build_password_service
from .modules.auth.repository import AuthRepository
from .platform.clock import utc_now

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_ABORTED = 3

PRODUCTION_MIN_LENGTH = 16
"""Production refuses a short bootstrap password even if the policy allows it."""


def _read_password(password_file: str | None, *, confirm: bool) -> str:
    if password_file:
        path = Path(password_file)
        if not path.is_file():
            raise SystemExit(f"Password file not found: {path}")
        # A secret file is the documented non-interactive mechanism. Only the
        # first line is used so a trailing newline is not part of the password.
        return path.read_text(encoding="utf-8").splitlines()[0]
    if not sys.stdin.isatty():
        raise SystemExit(
            "No terminal available for a hidden prompt. "
            "Use --password-file with a secret file instead."
        )
    password = getpass("New admin password: ")
    if confirm and password != getpass("Confirm admin password: "):
        raise SystemExit("Passwords did not match. No change was made.")
    return password


def _confirm_promotion(email: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        return False
    answer = input(f"Account {email} already exists. Promote it to admin? [y/N] ")
    return answer.strip().lower() in {"y", "yes"}


def create_admin(
    *,
    email: str,
    password_file: str | None,
    assume_yes: bool,
    reset_password: bool,
) -> int:
    """Create or promote exactly one administrator. Safe to run twice."""
    settings = get_settings()
    try:
        normalized = normalize_email(email)
    except InvalidEmailError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_USAGE

    passwords = build_password_service(settings)
    with SessionLocal() as session:
        repository = AuthRepository(session)
        existing = repository.find_user_by_canonical_email(normalized.canonical)

        if existing is not None and existing.role == "admin" and not reset_password:
            print(f"{normalized.canonical} is already an administrator. Nothing to do.")
            return EXIT_OK

        if existing is not None and not _confirm_promotion(normalized.canonical, assume_yes):
            print("Aborted. No change was made.", file=sys.stderr)
            return EXIT_ABORTED

        needs_password = existing is None or reset_password
        password = _read_password(password_file, confirm=needs_password) if needs_password else ""
        if needs_password:
            try:
                passwords.policy.validate(password)
            except PasswordPolicyError as error:
                print(f"error: {error.message}", file=sys.stderr)
                return EXIT_USAGE
            if settings.environment == "production" and len(password) < PRODUCTION_MIN_LENGTH:
                print(
                    "error: production requires an admin password of at least "
                    f"{PRODUCTION_MIN_LENGTH} characters.",
                    file=sys.stderr,
                )
                return EXIT_USAGE

        now = utc_now()
        if existing is None:
            user = repository.add_user(
                UserRecord(
                    email_display=normalized.display,
                    email_canonical=normalized.canonical,
                    password_hash=passwords.hash(password),
                    role="admin",
                    status="active",
                    email_verified_at=now,
                )
            )
            action = "created"
            previous_role = None
        else:
            user = existing
            previous_role = user.role
            user.role = "admin"
            user.status = "active"
            if reset_password:
                user.password_hash = passwords.hash(password)
                user.security_version += 1
                repository.revoke_all_sessions(
                    user.id, now=now, reason="admin_bootstrap", keep_session_id=None
                )
            if not user.email_verified:
                user.email_verified_at = now
            action = "promoted"

        audit.record_security_event(
            session,
            event=audit.ADMIN_BOOTSTRAP,
            outcome="success",
            actor_user_id=user.id,
            subject_user_id=user.id,
            metadata={
                "reason": action,
                "role": "admin",
                "previousRole": previous_role,
                "source": "cli",
            },
        )
        session.commit()
        admin_count = repository.count_admins()

    print(f"Administrator {action}: {normalized.canonical}")
    print(f"Administrators now configured: {admin_count}")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="Operator commands for the Label Normalizer API.",
        allow_abbrev=False,
    )
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser(
        "create-admin",
        help="Create the first administrator, or promote an existing account.",
        allow_abbrev=False,
    )
    admin.add_argument("--email", required=True, help="Account email address.")
    admin.add_argument(
        "--password-file",
        help="Read the password from the first line of this file instead of prompting.",
    )
    admin.add_argument(
        "--yes",
        action="store_true",
        help="Skip the promotion confirmation for an existing account.",
    )
    admin.add_argument(
        "--reset-password",
        action="store_true",
        help="Also set a new password and revoke every existing session.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.command == "create-admin":
        return create_admin(
            email=arguments.email,
            password_file=arguments.password_file,
            assume_yes=arguments.yes,
            reset_password=arguments.reset_password,
        )
    return EXIT_USAGE


if __name__ == "__main__":  # pragma: no cover - module entry point
    raise SystemExit(main())
