import os
from functools import lru_cache
from dotenv import load_dotenv

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    ConnectTimeoutError,
    ReadTimeoutError,
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

def _required(name: str, value: str | None) -> str:
    if value:
        return value
    raise RuntimeError(
        f"Missing {name}. Configure it in your .env file."
    )

@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "bedrock-runtime",
        region_name=os.getenv("AWS_REGION", "ap-south-1"),
        config=Config(
            connect_timeout=LLM_TIMEOUT,
            read_timeout=LLM_TIMEOUT,
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )

def _call_bedrock(prompt: str) -> str:
    inference_config = {
        "maxTokens": LLM_MAX_TOKENS,
    }
    if LLM_TEMPERATURE is not None:
        inference_config["temperature"] = LLM_TEMPERATURE
    response = _client().converse(
        modelId=_required("MODEL", LLM_MODEL),
        messages=[
            {
                "role": "user",
                "content": [{"text": prompt}],
            }
        ],
        inferenceConfig=inference_config,
    )
    content = response["output"]["message"]["content"]
    text = "".join(
        block.get("text", "")
        for block in content
        if isinstance(block, dict)
    ).strip()
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
    try:
        return _call_bedrock(prompt)

    except (ConnectTimeoutError, ReadTimeoutError) as exc:
        raise TimeoutError(
            f"Bedrock did not respond within {LLM_TIMEOUT:g} seconds."
        ) from exc

    except ClientError as exc:
        error = exc.response.get("Error", {})
        code = error.get("Code", "Unknown")
        message = error.get("Message", str(exc))

        raise RuntimeError(
            f"Bedrock API error ({code}): {message}"
        ) from exc

    except BotoCoreError as exc:
        raise RuntimeError(
            f"Could not communicate with Amazon Bedrock: {exc}"
        ) from exc
