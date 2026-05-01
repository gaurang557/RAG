from langchain_community.document_loaders import PyPDFLoader, UnstructuredPDFLoader
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from ask import ask_question



loader = PyPDFLoader("annualreport-page2-2025.pdf")
documents = loader.load()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=200,
    chunk_overlap=50
)

docs = text_splitter.split_documents(documents)

print(len(docs))


embeddings = HuggingFaceEmbeddings(
    model_name="all-MiniLM-L6-v2"
)


vectorstore = FAISS.from_documents(docs, embeddings)

query = "What was the net income in year 2025"

retriever = vectorstore.as_retriever()
# relevant_docs = retriever.invoke(query)

# print(relevant_docs[0].page_content)
print(ask_question(query, retriever))