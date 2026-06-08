# Huly DB-to-DB Migration Guide

For self-hosted Huly instances where you want to perform a **100% complete migration**—preserving all native history/audit logs, comment author metadata, creation timestamps, and exact file attachments—you must perform a direct database and file storage migration instead of an API-based import.

Huly self-hosted deployments run the following primary persistence stores:
1. **CockroachDB**: Primary relational database (PostgreSQL-compatible). Stores all structured data (workspaces, issues, comments, spaces, settings, teams, logs, etc.).
2. **MinIO**: Object storage (S3-compatible). Stores all files, images, attachments, and drawings.

---

## Step 1: Backup Source Instance Data

### 1. Back up CockroachDB
Run `cockroach dump` inside the running CockroachDB container on the source host:
```bash
# Export the database schema and data to a SQL file
docker exec -t huly-db ./cockroach dump huly --insecure > huly_db_backup.sql
```
*(Replace `huly-db` with the actual container name/ID of your source database).*

### 2. Back up MinIO File Attachments
If you are using Docker local volumes or host directory mounts (configured in your `compose.yml`), locate the directory bound to MinIO (e.g. `./minio-data` or a Docker volume named `minio_data`).
Create a tarball of the MinIO storage path:
```bash
# Archive the file storage directory
tar -czf huly_files_backup.tar.gz -C /var/lib/docker/volumes/huly-selfhost_minio_data/_data .
```
*(Adjust the path to match your actual MinIO mount or volume location).*

---

## Step 2: Restore Data to Target Instance

### 1. Restore MinIO File Attachments
Extract the file backup archive into the target instance's MinIO storage location *before* starting the target containers:
```bash
# Extract files to the target MinIO volume/directory
tar -xzf huly_files_backup.tar.gz -C /var/lib/docker/volumes/huly-selfhost_target_minio_data/_data
```

### 2. Restore CockroachDB
Start the database service on the target instance:
```bash
docker compose up -d db
```
Restore the SQL dump into the target CockroachDB database:
```bash
# Drop/Create clean database (if needed)
docker exec -it huly-target-db ./cockroach sql --insecure -e "DROP DATABASE IF EXISTS huly; CREATE DATABASE huly;"

# Import the SQL dump
docker exec -i huly-target-db ./cockroach sql --insecure --database=huly < huly_db_backup.sql
```

---

## Step 3: Re-index Search (Elasticsearch)

After both CockroachDB and MinIO are restored, you need to ensure the Elasticsearch index is fully built and synchronized with the newly imported database records. 

Here are the two ways to trigger search reindexing on the target instance:

### Option A: Wipe Elasticsearch Data (Recommended)
Before starting the target stack for the first time after DB restore, delete the Elasticsearch volume or data directory. When Huly starts up and detects a clean search index, the `huly-fulltext` service will automatically populate it by fetching and indexing all records from CockroachDB.

1. Stop the target Elasticsearch service (if running):
   ```bash
   docker compose down elastic
   ```
2. Clear the target Elasticsearch Docker volume or data directory:
   ```bash
   # If using a Docker volume:
   docker volume rm huly-selfhost_elastic_data
   # Or clear the mapped directory on the host:
   rm -rf /var/huly/elastic-data/*
   ```
3. Start the entire Huly stack:
   ```bash
   docker compose up -d
   ```
4. Monitor the indexing log via the `fulltext` container:
   ```bash
   docker logs -f huly-fulltext
   ```

### Option B: Trigger Manual Reindex via Elasticsearch API
If you prefer not to delete the volume, you can manually trigger index synchronization:

1. Query indices from the host to verify the current index name:
   ```bash
   curl -X GET "http://localhost:9200/_cat/indices?v"
   ```
2. Run a reindex command if there is an existing index to rebuild:
   ```bash
   curl -X POST "http://localhost:9200/_reindex" -H 'Content-Type: application/json' -d'
   {
     "source": { "index": "old_huly_index" },
     "dest": { "index": "new_huly_index" }
   }'
   ```
3. Alternatively, restart the indexing container to trigger automatic reconciliation with CockroachDB:
   ```bash
   docker compose restart fulltext
   ```
