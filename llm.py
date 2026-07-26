import os

import requests
from dotenv import load_dotenv

load_dotenv()

LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.1-8b-instant")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT_SECONDS", "30"))


def _extract_error_message(payload):
    if isinstance(payload, dict):
        error_obj = payload.get("error")
        if isinstance(error_obj, dict):
            return error_obj.get("message") or error_obj.get("error") or str(payload)
        return payload.get("message") or str(payload)
    return str(payload)


def _fetch_available_models(base_url, headers):
    try:
        response = requests.get(f"{base_url}/models", headers=headers, timeout=15)
        payload = response.json()
    except Exception:
        return []

    if not isinstance(payload, dict):
        return []

    models = payload.get("data")
    if not isinstance(models, list):
        return []

    return [m["id"] for m in models if isinstance(m, dict) and isinstance(m.get("id"), str)]


def call_grok(prompt: str) -> str:
    if LLM_API_KEY:
        provider_name = "Groq"
        api_key = LLM_API_KEY
        model = LLM_MODEL
        base_url = "https://api.groq.com/openai/v1"
    else:
        raise ValueError("Missing API key. Set LLM_API_KEY in your .env file.")

    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    data = {"model": model, "messages": [{"role": "user", "content": prompt}]}

    try:
        response = requests.post(url, headers=headers, json=data, timeout=LLM_TIMEOUT)
    except requests.exceptions.Timeout:
        raise TimeoutError(
            f"{provider_name} API did not respond within {LLM_TIMEOUT} seconds. "
            "Try again or check your network connection."
        )
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Could not connect to {provider_name} API. "
            "Check your network connection and try again."
        ) from exc

    try:
        payload = response.json()
    except ValueError:
        response.raise_for_status()
        raise RuntimeError(f"{provider_name} API returned a non-JSON response.")

    if response.status_code >= 400:
        error_msg = _extract_error_message(payload)
        error_text = str(error_msg).lower()
        if "model not found" in error_text:
            available_models = _fetch_available_models(base_url, headers)
            hint = (
                f" Set LLM_MODEL in .env to one of: {', '.join(available_models)}"
                if available_models
                else f" Set LLM_MODEL in .env to a valid model for your account."
            )
            raise RuntimeError(
                f"{provider_name} model not found ({response.status_code}): {error_msg}.{hint}"
            )
        raise RuntimeError(f"{provider_name} API error ({response.status_code}): {error_msg}")

    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected {provider_name} response type: {type(payload).__name__}")

    choices = payload.get("choices")
    if not choices:
        raise RuntimeError(f"Unexpected {provider_name} response format: {payload}")

    if not isinstance(choices[0], dict):
        raise RuntimeError(f"Unexpected choice format in {provider_name} response.")

    message = choices[0].get("message", {})
    if not isinstance(message, dict):
        raise RuntimeError(f"Unexpected message format in {provider_name} response.")

    content = message.get("content")
    if not content:
        raise RuntimeError(f"{provider_name} response missing message content.")

    return content
