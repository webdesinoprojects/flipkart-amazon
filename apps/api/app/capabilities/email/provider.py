"""The application-facing email capability.

Auth services depend on this protocol, never on a transport or a vendor SDK.
That keeps the delivery decision (disabled, local capture, generic SMTP, a
hosted provider later) out of the account lifecycle rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


class EmailDeliveryError(RuntimeError):
    """Raised when a configured provider could not accept a message.

    Callers translate this into a safe generic response; the underlying
    transport error is logged, never returned to the browser.
    """


@dataclass(frozen=True, slots=True)
class EmailMessage:
    to: str
    subject: str
    text_body: str


@runtime_checkable
class EmailProvider(Protocol):
    id: str

    @property
    def available(self) -> bool:
        """Whether delivery is currently configured and usable."""

    def send(self, message: EmailMessage) -> None:
        """Deliver ``message`` or raise :class:`EmailDeliveryError`."""
