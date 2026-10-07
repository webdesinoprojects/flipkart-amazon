import pytest

from app.modules.auth.email_address import InvalidEmailError, normalize_email


@pytest.mark.parametrize(
    ("submitted", "expected"),
    [
        ("Seller@Example.com", "seller@example.com"),
        ("  seller@example.com  ", "seller@example.com"),
        ("SELLER@EXAMPLE.COM", "seller@example.com"),
        ("seller@EXAMPLE.co.IN", "seller@example.co.in"),
    ],
)
def test_case_and_whitespace_collapse_to_one_identity(submitted, expected):
    assert normalize_email(submitted).canonical == expected


def test_display_form_keeps_what_the_person_typed():
    result = normalize_email("  Seller@Example.com ")
    assert result.display == "Seller@Example.com"
    assert result.canonical == "seller@example.com"


def test_gmail_dots_are_not_removed():
    """Stripping dots would merge two mailboxes some providers keep separate."""
    assert normalize_email("first.last@gmail.com").canonical == "first.last@gmail.com"
    assert normalize_email("firstlast@gmail.com").canonical != (
        normalize_email("first.last@gmail.com").canonical
    )


def test_plus_tags_are_not_removed():
    assert normalize_email("seller+flipkart@example.com").canonical == (
        "seller+flipkart@example.com"
    )


def test_internationalized_domain_is_normalized_consistently():
    first = normalize_email("seller@Bücher.example")
    second = normalize_email("seller@bücher.example")
    assert first.canonical == second.canonical
    assert first.domain == second.domain


def test_unicode_local_part_is_accepted_and_lowercased():
    assert normalize_email("Ünïcode@example.com").canonical == "ünïcode@example.com"


@pytest.mark.parametrize(
    "submitted",
    [
        "",
        "   ",
        None,
        "not-an-email",
        "@example.com",
        "seller@",
        "seller@@example.com",
        "seller example@test.com",
        "seller@example.com\nBcc: attacker@evil.test",
        "a" * 250 + "@example.com",
    ],
)
def test_malformed_and_malicious_values_are_rejected(submitted):
    with pytest.raises(InvalidEmailError):
        normalize_email(submitted)


def test_header_injection_characters_cannot_survive_normalization():
    """A newline must never reach an SMTP header through the account identity."""
    with pytest.raises(InvalidEmailError):
        normalize_email("seller@example.com\r\nSubject: hijacked")
