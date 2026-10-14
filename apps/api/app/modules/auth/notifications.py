"""SellerLabel transactional account messages.

Links are built only from the configured application origin. A request's
``Host`` header is never used, so an attacker cannot substitute their URL.
"""

from __future__ import annotations

from html import escape
from urllib.parse import quote

from ...capabilities.email.provider import EmailMessage
from ...config import Settings

VERIFY_PATH = "/verify-email"
RESET_PATH = "/reset-password"


def verification_link(settings: Settings, token: str) -> str:
    return f"{settings.primary_origin}{VERIFY_PATH}?token={quote(token, safe='')}"


def reset_link(settings: Settings, token: str) -> str:
    return f"{settings.primary_origin}{RESET_PATH}?token={quote(token, safe='')}"


def verification_message(settings: Settings, *, to: str, token: str, code: str) -> EmailMessage:
    minutes = settings.auth_verification_token_ttl_seconds // 60
    link = verification_link(settings, token)
    return EmailMessage(
        to=to,
        subject=f"{code} is your SellerLabel verification code",
        text_body=(
            "Welcome to SellerLabel.\n\n"
            f"Your verification code is: {code}\n\n"
            f"Or verify this email using the secure link: {link}\n\n"
            f"The code and link can be used once and expire in {minutes} minutes.\n"
            "If you did not create a SellerLabel account, ignore this message.\n"
        ),
        html_body=_email_html(
            eyebrow="SELLER ACCOUNT / EMAIL CHECK",
            heading="Complete registration",
            body=(
                "Enter this confirmation code in the SellerLabel window where you "
                "started creating your account."
            ),
            code=code,
            button_label="Verify your email",
            button_url=link,
            footnote=(
                f"This code and link expire in {minutes} minutes and can be used once. "
                "If you did not create this account, no action is needed."
            ),
        ),
    )


def existing_account_message(settings: Settings, *, to: str) -> EmailMessage:
    login = f"{settings.primary_origin}/login"
    reset = f"{settings.primary_origin}/forgot-password"
    return EmailMessage(
        to=to,
        subject="A SellerLabel account already uses this email",
        text_body=(
            "An account already exists for this email address, so no new account was "
            "created.\n\n"
            f"Sign in at {login}\n"
            f"Reset your password at {reset}\n\n"
            "If this was not you, no action is required.\n"
        ),
        html_body=_email_html(
            eyebrow="ACCOUNT NOTICE",
            heading="Your account already exists",
            body=(
                "Someone tried to register this email address. Your existing account "
                "was not changed."
            ),
            button_label="Sign in to SellerLabel",
            button_url=login,
            secondary_label="Reset password",
            secondary_url=reset,
            footnote="If this was not you, no action is required.",
        ),
    )


def reset_message(settings: Settings, *, to: str, token: str) -> EmailMessage:
    minutes = settings.auth_reset_token_ttl_seconds // 60
    link = reset_link(settings, token)
    return EmailMessage(
        to=to,
        subject="Reset your SellerLabel password",
        text_body=(
            "Use the link below to choose a new password.\n\n"
            f"{link}\n\n"
            f"The link can be used once and expires in {minutes} minutes. "
            "Completing a reset signs out every device.\n"
            "If you did not ask for this, ignore this message.\n"
        ),
        html_body=_email_html(
            eyebrow="PASSWORD RESET",
            heading="Choose a new password",
            body="Use the secure button below to reset your SellerLabel password.",
            button_label="Reset password",
            button_url=link,
            footnote=(
                f"This link expires in {minutes} minutes. Resetting your password "
                "signs out every device."
            ),
        ),
    )


def _email_html(
    *,
    eyebrow: str,
    heading: str,
    body: str,
    button_label: str,
    button_url: str,
    footnote: str,
    code: str | None = None,
    secondary_label: str | None = None,
    secondary_url: str | None = None,
) -> str:
    body_style = "margin:0;background:#edf1ea;color:#182019;font-family:Courier New,monospace"
    outer_style = "background:#edf1ea;padding:32px 14px"
    card_style = (
        "max-width:560px;background:#fbfcf8;border:1px solid #cdd5cb;"
        "border-radius:22px;overflow:hidden;"
        "box-shadow:0 24px 70px rgba(30,50,35,.13)"
    )
    header_style = "padding:25px 30px;background:#dff2e1;border-bottom:1px solid #cdd5cb"
    brand_style = "font-size:18px;font-weight:700;letter-spacing:-.5px"
    strapline_style = "color:#5d6c61;font-size:10px;letter-spacing:1px"
    eyebrow_style = (
        "margin:0 0 13px;color:#4f6b59;font-size:11px;font-weight:700;letter-spacing:1.4px"
    )
    heading_style = (
        "margin:0 0 16px;font-family:Georgia,serif;font-size:40px;"
        "font-weight:400;letter-spacing:-1.5px;line-height:1.05"
    )
    copy_style = (
        "margin:0;color:#5f685f;font-family:Arial,sans-serif;font-size:15px;line-height:1.65"
    )
    button_intro_style = (
        "margin:4px 0 10px;color:#5f685f;font-family:Arial,sans-serif;font-size:13px"
    )
    button_style = (
        "display:inline-block;padding:14px 24px;border-radius:999px;"
        "background:#192019;color:#fff;font-family:Arial,sans-serif;"
        "font-size:13px;font-weight:700;text-decoration:none"
    )
    footnote_style = (
        "margin:32px 0 0;padding-top:22px;border-top:1px solid #d9dfd6;"
        "color:#748077;font-family:Arial,sans-serif;font-size:12px;line-height:1.6"
    )
    footer_style = "padding:19px 30px;background:#eef2eb;color:#758078;font-size:10px"
    code_block = (
        f'<div style="margin:26px 0;padding:22px;border:1px solid #d8ded5;'
        f"border-radius:13px;background:#fff;text-align:center;font-family:"
        f"Courier New,monospace;font-size:34px;font-weight:700;letter-spacing:12px;"
        f'color:#172018;box-shadow:0 7px 24px rgba(23,32,24,.10)">{escape(code)}</div>'
        if code
        else ""
    )
    secondary = (
        f'<p style="margin:18px 0 0"><a href="{escape(secondary_url or "")}" '
        f'style="color:#176c47;font-family:Arial,sans-serif;font-size:13px">'
        f"{escape(secondary_label or '')}</a></p>"
        if secondary_label and secondary_url
        else ""
    )
    return f"""<!doctype html>
<html><body style="{body_style}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="{outer_style}">
<tr><td align="center"><table role="presentation" width="100%" cellspacing="0"
cellpadding="0" style="{card_style}">
<tr><td style="{header_style}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td style="{brand_style}">SELLER<span style="color:#148e54">LABEL</span></td>
<td align="right" style="{strapline_style}">PRINT READY</td>
</tr></table></td></tr>
<tr><td style="padding:38px 30px 34px">
<p style="{eyebrow_style}">{escape(eyebrow)}</p>
<h1 style="{heading_style}">{escape(heading)}</h1>
<p style="{copy_style}">{escape(body)}</p>
{code_block}
<p style="{button_intro_style}">Or use the secure button:</p>
<p style="margin:0"><a href="{escape(button_url)}" style="{button_style}">
{escape(button_label)}</a></p>
{secondary}
<p style="{footnote_style}">{escape(footnote)}</p>
</td></tr>
<tr><td style="{footer_style}">
SELLERLABEL &middot; sellerlabel.in &middot; Reply to this email for support
</td></tr>
</table></td></tr></table></body></html>"""
