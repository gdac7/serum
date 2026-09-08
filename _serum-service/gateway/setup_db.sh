#!/usr/bin/env bash
# Gateway's own Postgres, separate from the Python service's DB.
# Port 5433 on the host so it never clashes with the Python DB on 5432.
docker run -d --name gateway-pg \
  -e POSTGRES_USER=gateway \
  -e POSTGRES_PASSWORD=gateway \
  -e POSTGRES_DB=gateway \
  -p 5433:5432 \
  postgres:17
