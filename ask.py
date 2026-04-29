def ask_question(query):
    relevant_docs = retriever.invoke(query)

    context = "\n".join([doc.page_content for doc in relevant_docs])

    prompt = f"""
    You are an AI assistant.

    Answer ONLY from the context below.
    If answer is not in context, say "Not found".

    Context:
    {context}

    Question:
    {query}
    """

    return call_grok(prompt)