import os
import requests
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")


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

    ids = []
    for model in models:
        if isinstance(model, dict) and isinstance(model.get("id"), str):
            ids.append(model["id"])
    return ids


def call_grok(prompt):
    # Prefer Groq if GROQ_API_KEY is present, otherwise use xAI Grok.
    if GROQ_API_KEY:
        provider_name = "Groq"
        api_key = GROQ_API_KEY
        model = GROQ_MODEL
        base_url = "https://api.groq.com/openai/v1"
    else:
        raise ValueError("Missing API key. Set GROQ_API_KEY (or GROK_API_KEY).")

    url = f"{base_url}/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    data = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    response = requests.post(url, headers=headers, json=data, timeout=30)

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
            if available_models:
                raise RuntimeError(
                    f"{provider_name} API error "
                    f"({response.status_code}): {error_msg}. "
                    f"Set {'GROQ_MODEL' if provider_name == 'Groq' else 'GROK_MODEL'} in .env to one of: {', '.join(available_models)}"
                )
            raise RuntimeError(
                f"{provider_name} API error "
                f"({response.status_code}): {error_msg}. "
                f"Set {'GROQ_MODEL' if provider_name == 'Groq' else 'GROK_MODEL'} in .env to a valid model for your account."
            )
        raise RuntimeError(f"{provider_name} API error ({response.status_code}): {error_msg}")

    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected {provider_name} response type: {type(payload).__name__} | {payload}")

    choices = payload.get("choices")
    if not choices:
        raise RuntimeError(f"Unexpected {provider_name} response format: {payload}")

    if not isinstance(choices[0], dict):
        raise RuntimeError(f"Unexpected choice format in {provider_name} response: {payload}")

    message = choices[0].get("message", {})
    if not isinstance(message, dict):
        raise RuntimeError(f"Unexpected message format in {provider_name} response: {payload}")

    content = message.get("content")
    if not content:
        raise RuntimeError(f"{provider_name} response missing message content: {payload}")

    return content