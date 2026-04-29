from langchain_community.document_loaders import PyPDFLoader, UnstructuredPDFLoader
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
import ask, llm

loader = PyPDFLoader("annualreport-2025.pdf")
documents = loader.load()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)

docs = text_splitter.split_documents(documents)

print(len(docs))


embeddings = HuggingFaceEmbeddings(
    model_name="all-MiniLM-L6-v2"
)


vectorstore = FAISS.from_documents(docs, embeddings)

query = "What is this document about?"

retriever = vectorstore.as_retriever()
relevant_docs = retriever.invoke(query)

print(relevant_docs[1].page_content)