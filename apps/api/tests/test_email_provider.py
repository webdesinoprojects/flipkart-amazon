from unittest.mock import MagicMock, patch

from app.capabilities.email.provider import EmailMessage
from app.config import Settings
from app.providers.email import SmtpEmailProvider, build_email_provider


def test_smtp_provider_builds_resend_compatible_multipart_message():
    settings = Settings(
        email_provider="smtp",
        smtp_host="smtp.resend.com",
        smtp_port=587,
        smtp_username="resend",
        smtp_password="re_test_key",
        smtp_starttls=True,
        email_from_address="accounts@sellerlabel.in",
        email_from_name="SellerLabel",
        email_reply_to="sellerlabels@gmail.com",
    )
    provider = build_email_provider(settings)
    assert isinstance(provider, SmtpEmailProvider)

    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    with patch("app.providers.email.smtplib.SMTP", return_value=smtp) as smtp_factory:
        provider.send(
            EmailMessage(
                to="seller@example.com",
                subject="Complete registration",
                text_body="Code: 370030",
                html_body="<strong>370030</strong>",
            )
        )

    smtp_factory.assert_called_once_with("smtp.resend.com", 587, timeout=10)
    smtp.starttls.assert_called_once_with()
    smtp.login.assert_called_once_with("resend", "re_test_key")
    message = smtp.send_message.call_args.args[0]
    assert message["From"] == "SellerLabel <accounts@sellerlabel.in>"
    assert message["Reply-To"] == "sellerlabels@gmail.com"
    assert message.is_multipart()
    assert "<strong>370030</strong>" in message.get_body(preferencelist=("html",)).get_content()
