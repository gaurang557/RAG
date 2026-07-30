"""Small CLI for testing retrieval against an already indexed Neon document."""

import argparse

from rag_api.ask import ask_question
from rag_api.rag_service import neon_retriever


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("session_id", help="Document session UUID")
    parser.add_argument("user_id", type=int, help="Owner's user ID")
    parser.add_argument("question", help="Question to ask")
    args = parser.parse_args()

    retriever = neon_retriever(args.session_id, args.user_id)
    print(ask_question(args.question, retriever))


if __name__ == "__main__":
    main()
