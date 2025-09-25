from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping

from fastapi import Header

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# Prefer client/locales (renderer source) and fall back to legacy root/locales for backward compatibility
LOCALE_DIR_CANDIDATES = (
    PROJECT_ROOT / "client" / "locales",
    PROJECT_ROOT / "locales",
)
DEFAULT_LOCALE = "en"
SUPPORTED_LOCALES: Iterable[str] = ("en", "zh")


class I18n:
    """Simple JSON-based translation loader shared between services."""

    def __init__(self, default_locale: str = DEFAULT_LOCALE) -> None:
        self.default_locale = default_locale
        self._cache: Dict[str, Dict[str, Any]] = {}

    def available_locales(self) -> Iterable[str]:
        return SUPPORTED_LOCALES

    def translate(
        self,
        key: str,
        locale: str | None = None,
        params: Mapping[str, Any] | None = None,
    ) -> str:
        target_locale = self._normalize_locale(locale)
        translation = self._resolve(target_locale, key)

        if translation is None and target_locale != self.default_locale:
            translation = self._resolve(self.default_locale, key)

        if isinstance(translation, str):
            return self._format(translation, params)

        logger.warning("Missing translation for key '%s' in locale '%s'", key, target_locale)
        return key

    def load(self, locale: str) -> Dict[str, Any]:
        normalized = self._normalize_locale(locale)
        if normalized not in self._cache:
            data: Dict[str, Any] | None = None
            last_error: Exception | None = None
            for base_dir in LOCALE_DIR_CANDIDATES:
                path = base_dir / f"{normalized}.json"
                try:
                    if path.exists():
                        with path.open("r", encoding="utf-8") as handle:
                            data = json.load(handle)
                            break
                except json.JSONDecodeError as exc:
                    last_error = exc
                    logger.error("Failed to parse locale file %s: %s", path, exc)
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    logger.error("Error reading locale file %s: %s", path, exc)

            if data is None:
                if last_error is None:
                    logger.error(
                        "Locale file not found for '%s' in: %s",
                        normalized,
                        ", ".join(str(p) for p in LOCALE_DIR_CANDIDATES),
                    )
                self._cache[normalized] = {}
            else:
                self._cache[normalized] = data
        return self._cache[normalized]

    def _normalize_locale(self, locale: str | None) -> str:
        if locale and locale in SUPPORTED_LOCALES:
            return locale
        return self.default_locale

    def _resolve(self, locale: str, key: str) -> Any:
        data = self.load(locale)
        current: Any = data
        for segment in key.split('.'):
            if not isinstance(current, dict) or segment not in current:
                return None
            current = current[segment]
        return current

    def _format(self, template: str, params: Mapping[str, Any] | None) -> str:
        if not params:
            return template
        result = template
        for parameter, value in params.items():
            result = result.replace('{%s}' % parameter, str(value))
        return result


def t(key: str, locale: str | None = None, **params: Any) -> str:
    return I18N.translate(key, locale=locale, params=params or None)


async def resolve_locale(accept_language: str | None = Header(default=None)) -> str:
    return detect_locale(accept_language)


def detect_locale(accept_language: str | None) -> str:
    """Detect locale from Accept-Language header."""
    if not accept_language:
        return DEFAULT_LOCALE
    
    # Parse Accept-Language header
    # Format: "zh-CN,zh;q=0.9,en;q=0.8"
    languages = []
    for item in accept_language.split(','):
        item = item.strip()
        if ';' in item:
            lang, q = item.split(';', 1)
            try:
                q_value = float(q.split('=')[1])
            except (ValueError, IndexError):
                q_value = 1.0
        else:
            lang = item
            q_value = 1.0
        languages.append((lang.split('-')[0], q_value))  # Take base language
    
    # Sort by quality
    languages.sort(key=lambda x: x[1], reverse=True)
    
    # Find first supported locale
    for lang, _ in languages:
        if lang in SUPPORTED_LOCALES:
            return lang
    
    return DEFAULT_LOCALE


I18N = I18n()
