#!/usr/bin/env bash
# Redis backing the BullMQ run queue. Default port 6379.
docker run -d --name gateway-redis \
  -p 6379:6379 \
  redis:7
