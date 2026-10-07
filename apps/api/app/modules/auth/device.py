"""Coarse device description for the user-visible session list.

A raw ``User-Agent`` string is a strong fingerprint and is not stored. Only a
bounded "<browser> on <platform>" summary is kept, which is enough for a person
to recognise their own device in the security page and nothing more.
"""

from __future__ import annotations

UNKNOWN_DEVICE = "Unknown device"
_MAX_LENGTH = 80

_BROWSERS: tuple[tuple[str, str], ...] = (
    ("edg/", "Edge"),
    ("opr/", "Opera"),
    ("firefox/", "Firefox"),
    ("chrome/", "Chrome"),
    ("safari/", "Safari"),
)

_PLATFORMS: tuple[tuple[str, str], ...] = (
    ("android", "Android"),
    ("iphone", "iPhone"),
    ("ipad", "iPad"),
    ("windows", "Windows"),
    ("mac os x", "macOS"),
    ("cros", "ChromeOS"),
    ("linux", "Linux"),
)


def summarize_device(user_agent: str | None) -> str:
    """Return a short, non-identifying description of the client."""
    lowered = (user_agent or "").lower()
    if not lowered:
        return UNKNOWN_DEVICE
    browser = next((label for marker, label in _BROWSERS if marker in lowered), None)
    platform = next((label for marker, label in _PLATFORMS if marker in lowered), None)
    if browser and platform:
        summary = f"{browser} on {platform}"
    elif browser:
        summary = browser
    elif platform:
        summary = platform
    else:
        return UNKNOWN_DEVICE
    return summary[:_MAX_LENGTH]
