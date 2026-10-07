from app.modules.auth.tokens import (
    MAX_TOKEN_LENGTH,
    digest_token,
    generate_token,
    looks_like_token,
    tokens_match,
)

SECRET = "test-only-auth-secret-value-at-least-32-chars"


def test_generated_tokens_are_long_random_and_url_safe():
    tokens = {generate_token() for _ in range(200)}
    assert len(tokens) == 200, "every token must be distinct"
    for token in tokens:
        assert len(token) >= 43, "32 random bytes encode to at least 43 characters"
        assert looks_like_token(token)
        assert token == token.strip()


def test_digest_is_stable_keyed_and_hex():
    token = generate_token()
    assert digest_token(token, secret=SECRET) == digest_token(token, secret=SECRET)
    assert len(digest_token(token, secret=SECRET)) == 64
    assert digest_token(token, secret=SECRET) != digest_token(token, secret="another-secret")


def test_digest_does_not_contain_the_token():
    token = generate_token()
    assert token not in digest_token(token, secret=SECRET)


def test_rotating_the_secret_invalidates_every_digest():
    token = generate_token()
    stored = digest_token(token, secret=SECRET)
    assert tokens_match(token=token, expected_digest=stored, secret=SECRET)
    assert not tokens_match(token=token, expected_digest=stored, secret="rotated-secret")


def test_match_rejects_empty_and_oversized_input():
    token = generate_token()
    stored = digest_token(token, secret=SECRET)
    assert not tokens_match(token="", expected_digest=stored, secret=SECRET)
    assert not tokens_match(token=token, expected_digest="", secret=SECRET)
    assert not tokens_match(
        token="x" * (MAX_TOKEN_LENGTH + 1), expected_digest=stored, secret=SECRET
    )


def test_shape_check_rejects_malformed_values_before_a_digest_is_computed():
    assert not looks_like_token(None)
    assert not looks_like_token("")
    assert not looks_like_token("tooshort")
    assert not looks_like_token("has spaces in it and is long enough")
    assert not looks_like_token("semi;colon;injection;attempt;long;enough")
    assert not looks_like_token("x" * (MAX_TOKEN_LENGTH + 1))
    assert looks_like_token("abcdef-_1234567890ABCDEF")
