from llm import call_grok


def ask_question(query, retriever):
    relevant_docs = retriever.invoke(query)
    passages = []
    for d in relevant_docs:
        text = getattr(d, "page_content", None) or ""
        text = text.strip()
        if text:
            passages.append(text)

    if not passages:
        return (
            "No passages were retrieved from your document for this question. "
            "Try keywords that appear in the PDF, or shorten / rephrase the question."
        )

    context = "\n---\n".join(passages)

    prompt = f"""You answer questions using ONLY the excerpts below.

Rules:
- Use the excerpts as your only source of facts.
- Prefer a concise, direct answer. If the excerpts only partially relate, summarize what they do say and note what they do not cover.
- If the excerpts genuinely do not address the question at all, reply exactly: Cannot answer from this document.

Excerpts:
{context}

Question:
{query}
"""

    return call_grok(prompt)
