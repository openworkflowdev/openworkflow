#!/bin/sh
docker run -ti -e DATABASE_URL='postgres://postgres:postgres@host.docker.internal:5432/postgres' -p 8080:8080 ankane/pghero
