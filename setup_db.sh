# This needs to be runned in the same host of the service container (for while)
# docker run -d --name pgvector -e POSTGRES_PASSWORD=gdac1908 -p 4534:5432 pgvector/pgvector:pg17export DATABASE_URL="postgresql://postgres:gdac1908@localhost:5432/postgres"
export DATABASE_URL="postgresql://postgres:gdac1908@localhost:5432/postgres"
pip install "psycopg[binary,pool]" pgvector
