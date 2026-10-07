"""Explicit, testable email normalization for account identity.

Two addresses are considered the same account when their canonical forms match.
The canonical form lowercases the whole address and applies IDNA/Unicode
normalization to the domain. It deliberately performs **no** provider-specific
rewriting: Gmail dot-stripping and `+tag` removal are not applied, because both
can merge two addresses that a provider treats as distinct mailboxes and would
let one person silently take over another person's sign-up identity.
"""

from __future__ import annotations

from dataclasses import dataclass

from email_validator import EmailNotValidError, validate_email

MAX_EMAIL_LENGTH = 254
"""Practical RFC 5321 limit for a forward path, enforced before hashing."""


class InvalidEmailError(ValueError):
    """Raised when an address cannot be parsed into a canonical form."""


@dataclass(frozen=True, slots=True)
class NormalizedEmail:
    """A validated address plus the canonical value used for uniqueness."""

    display: str
    """The submitted address with surrounding whitespace removed."""

    canonical: str
    """Lowercased, IDNA-normalized form carrying the uniqueness constraint."""

    domain: str
    """Canonical domain, useful for safe aggregate metrics."""


def normalize_email(raw: str | None) -> NormalizedEmail:
    """Return the canonical identity for ``raw`` or raise :class:`InvalidEmailError`."""
    candidate = (raw or "").strip()
    if not candidate:
        raise InvalidEmailError("An email address is required.")
    if len(candidate) > MAX_EMAIL_LENGTH:
        raise InvalidEmailError("That email address is too long.")
    if any(character.isspace() for character in candidate):
        raise InvalidEmailError("An email address cannot contain spaces.")
    try:
        validated = validate_email(
            candidate,
            check_deliverability=False,
            allow_smtputf8=True,
        )
    except EmailNotValidError as error:
        raise InvalidEmailError("Enter a valid email address.") from error

    # ``normalized`` already lowercases/IDNA-normalizes the domain and applies
    # Unicode NFC to an internationalized local part. Lowercasing the local part
    # is an additional, deliberate product decision so that "Seller@x.com" and
    # "seller@x.com" cannot become two accounts.
    local_part, _, domain = validated.normalized.rpartition("@")
    canonical = f"{local_part.lower()}@{domain.lower()}"
    if len(canonical) > MAX_EMAIL_LENGTH:
        raise InvalidEmailError("That email address is too long.")
    return NormalizedEmail(display=candidate, canonical=canonical, domain=domain.lower())
