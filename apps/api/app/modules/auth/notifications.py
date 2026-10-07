"""Composes the two transactional messages the account lifecycle sends.

Links are always built from the configured application origin. A request's
``Host`` header is never used, so an attacker cannot make the product email a
victim a verification link that points at the attacker's site.
"""

from __future__ import annotations

from urllib.parse import quote

from ...capabilities.email.provider import EmailMessage
from ...config import Settings

VERIFY_PATH = "/verify-email"
RESET_PATH = "/reset-password"


def verification_link(settings: Settings, token: str) -> str:
    return f"{settings.primary_origin}{VERIFY_PATH}?token={quote(token, safe='')}"


def reset_link(settings: Settings, token: str) -> str:
    return f"{settings.primary_origin}{RESET_PATH}?token={quote(token, safe='')}"


def verification_message(settings: Settings, *, to: str, token: str) -> EmailMessage:
    minutes = settings.auth_verification_token_ttl_seconds // 60
    return EmailMessage(
        to=to,
        subject="Verify your Label Normalizer email address",
        text_body=(
            "Confirm this address to finish setting up your Label Normalizer account.\n\n"
            f"{verification_link(settings, token)}\n\n"
            f"The link can be used once and expires in {minutes} minutes.\n"
            "If you did not create an account, you can ignore this message.\n"
        ),
    )


def existing_account_message(settings: Settings, *, to: str) -> EmailMessage:
    """Sent when someone tries to register an address that already exists.

    Registration responses are identical either way, so this message is what
    tells the real owner that an attempt happened — without telling the person
    who submitted the form whether the account exists.
    """
    return EmailMessage(
        to=to,
        subject="Someone tried to create a Label Normalizer account with your email",
        text_body=(
            "An account already exists for this email address, so no new account was "
            "created.\n\n"
            f"Sign in at {settings.primary_origin}/login\n"
            f"Reset your password at {settings.primary_origin}/forgot-password\n\n"
            "If this was not you, no action is required.\n"
        ),
    )


def reset_message(settings: Settings, *, to: str, token: str) -> EmailMessage:
    minutes = settings.auth_reset_token_ttl_seconds // 60
    return EmailMessage(
        to=to,
        subject="Reset your Label Normalizer password",
        text_body=(
            "Use the link below to choose a new password.\n\n"
            f"{reset_link(settings, token)}\n\n"
            f"The link can be used once and expires in {minutes} minutes. "
            "Completing a reset signs out every device.\n"
            "If you did not ask for this, you can ignore this message and your "
            "password stays unchanged.\n"
        ),
    )
