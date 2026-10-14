"""Email transport adapters for the :mod:`app.capabilities.email` capability.

Missing credentials never prevent boot. With no SMTP host configured the
application selects :class:`DisabledEmailProvider`, readiness reports that
delivery is unavailable, and the UI says so honestly instead of claiming an
email was sent.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage as MimeMessage

from ..capabilities.email.provider import EmailDeliveryError, EmailMessage, EmailProvider
from ..config import Settings

logger = logging.getLogger("app.email")


class DisabledEmailProvider:
    """Records that a message was requested without delivering it.

    Only non-identifying metadata is logged: no address, no link, no token.
    """

    id = "disabled"

    @property
    def available(self) -> bool:
        return False

    def send(self, message: EmailMessage) -> None:
        logger.info(
            "email_delivery_disabled",
            extra={"subject": message.subject, "recipient_domain": _domain_of(message.to)},
        )


class SmtpEmailProvider:
    """Generic SMTP transport, also used for the local Mailpit capture path."""

    id = "smtp"

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        use_starttls: bool,
        timeout_seconds: float,
        from_address: str,
        from_name: str,
        reply_to: str,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_starttls = use_starttls
        self._timeout_seconds = timeout_seconds
        self._from_address = from_address
        self._from_name = from_name
        self._reply_to = reply_to

    @property
    def available(self) -> bool:
        return bool(self._host)

    def send(self, message: EmailMessage) -> None:
        mime = MimeMessage()
        mime["From"] = f"{self._from_name} <{self._from_address}>"
        mime["To"] = message.to
        mime["Subject"] = message.subject
        if self._reply_to:
            mime["Reply-To"] = self._reply_to
        mime["Auto-Submitted"] = "auto-generated"
        mime.set_content(message.text_body)
        if message.html_body:
            mime.add_alternative(message.html_body, subtype="html")
        try:
            # Every outbound call is bounded; a hung SMTP server must not pin a
            # request worker. There is no retry here: the caller already returns
            # a generic response and the user can request another email.
            with smtplib.SMTP(self._host, self._port, timeout=self._timeout_seconds) as client:
                if self._use_starttls:
                    client.starttls()
                if self._username:
                    client.login(self._username, self._password)
                client.send_message(mime)
        except (OSError, smtplib.SMTPException) as error:
            logger.warning(
                "email_delivery_failed",
                extra={"error_type": type(error).__name__, "provider": self.id},
            )
            raise EmailDeliveryError("Email delivery failed.") from error


def build_email_provider(settings: Settings) -> EmailProvider:
    """Select a provider from settings without ever failing startup."""
    if settings.email_provider == "disabled":
        return DisabledEmailProvider()
    if settings.email_provider in {"auto", "smtp"} and settings.smtp_configured:
        return SmtpEmailProvider(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_starttls=settings.smtp_starttls,
            timeout_seconds=settings.smtp_timeout_seconds,
            from_address=settings.email_from_address,
            from_name=settings.email_from_name,
            reply_to=settings.email_reply_to,
        )
    return DisabledEmailProvider()


def _domain_of(address: str) -> str:
    _, _, domain = address.rpartition("@")
    return domain.lower()
