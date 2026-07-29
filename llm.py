import os
from functools import lru_cache

from dotenv import load_dotenv
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    OpenAI,
)

load_dotenv()

LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_BASE_URL = os.getenv("LLM_BASE_URL")
LLM_MODEL = os.getenv("LLM_MODEL")
LLM_API_STYLE = os.getenv("LLM_API_STYLE", "responses").strip().lower()
LLM_MAX_TOKENS = int(
    os.getenv("LLM_MAX_TOKENS")
    or os.getenv("BEDROCK_MAX_TOKENS")
    or "1000"
)
LLM_TIMEOUT = float(
    os.getenv("LLM_TIMEOUT_SECONDS")
    or os.getenv("LLM_TIMEOUT")
    or "30"
)
_temperature_raw = os.getenv("LLM_TEMPERATURE")
LLM_TEMPERATURE = (
    float(_temperature_raw) if _temperature_raw not in (None, "") else None
)

print(LLM_API_KEY)
print(LLM_MODEL)

def _required(name: str, value: str | None) -> str:
    if value:
        return value
    raise RuntimeError(
        f"Missing {name}. Configure it in your .env file."
    )


@lru_cache(maxsize=1)
def _client() -> OpenAI:
    return OpenAI(
        api_key=_required("API_KEY", LLM_API_KEY),
        base_url=_required("BASE_URL", LLM_BASE_URL),
        timeout=LLM_TIMEOUT,
        max_retries=2,
    )


def _call_responses(prompt: str) -> str:
    request = {
        "model": _required("MODEL", LLM_MODEL),
        "input": [{"role": "user", "content": prompt}],
        # "max_output_tokens": LLM_MAX_TOKENS,
        # Bedrock Mantle otherwise stores Responses API state for up to 30 days.
        "store": False,
    }
    if LLM_TEMPERATURE is not None:
        request["temperature"] = LLM_TEMPERATURE

    response = _client().responses.create(**request)
    text = response.output_text.strip() if response.output_text else ""
    if not text:
        raise RuntimeError("The configured LLM returned no text.")
    return text


def _call_chat_completions(prompt: str) -> str:
    request = {
        "model": _required("MODEL", LLM_MODEL),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": LLM_MAX_TOKENS,
    }
    if LLM_TEMPERATURE is not None:
        request["temperature"] = LLM_TEMPERATURE

    response = _client().chat.completions.create(**request)
    if not response.choices:
        raise RuntimeError("The configured LLM returned no choices.")

    content = response.choices[0].message.content
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("The configured LLM returned no text.")
    return content.strip()


def call_llm(prompt: str) -> str:
    """Call the configured provider through an OpenAI-compatible API."""
    try:
        if LLM_API_STYLE == "responses":
            return _call_responses(prompt)
        if LLM_API_STYLE == "chat_completions":
            return _call_chat_completions(prompt)
        raise RuntimeError(
            "Unsupported LLM_API_STYLE. Use 'responses' or 'chat_completions'."
        )
    except APITimeoutError as exc:
        raise TimeoutError(
            f"The configured LLM did not respond within {LLM_TIMEOUT:g} seconds."
        ) from exc
    except APIConnectionError as exc:
        raise RuntimeError(
            f"Could not connect to the configured LLM endpoint: {LLM_BASE_URL}"
        ) from exc
    except APIStatusError as exc:
        request_id = getattr(exc, "request_id", None)
        request_hint = f", request ID {request_id}" if request_id else ""
        raise RuntimeError(
            f"LLM API error ({exc.status_code}{request_hint}): {exc.message}"
        ) from exc
