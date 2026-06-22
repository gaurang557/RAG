from langchain_community.document_loaders import PyPDFLoader
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from ask import ask_question
from rag_service import rag_retriever

loader = PyPDFLoader("annualreport-page2-2025.pdf")
documents = loader.load()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=900,
    chunk_overlap=180,
)

docs = text_splitter.split_documents(documents)

print(len(docs))

embeddings = HuggingFaceEmbeddings(
    model_name="all-MiniLM-L6-v2"
)

vectorstore = FAISS.from_documents(docs, embeddings)

query = "What was the net income in year 2025"

retriever = rag_retriever(vectorstore)
print(ask_question(query, retriever))