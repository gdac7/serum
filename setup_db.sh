# This needs to be runned in the same host of the service container (for while)
# docker run -p 5432:5432 -d --name pgvector -e POSTGRES_PASSWORD=gdac1908 -p 5432:5432 pgvector/pgvector:pg17
export DATABASE_URL="postgresql://postgres:gdac1908@localhost:5432/postgres"
pip install "psycopg[binary,pool]" pgvector
