# API-Based Content Migration Guide

For migrations where direct server/database access is not available (such as Huly Cloud hosted instances, or restricted environments), you can use the `huly-data-xport` tool to perform an **API-based export and import** using Huly's universal file format.

This method operates purely over Huly's client WebSocket transactor and HTTP endpoints using your account credentials.

---

## The Migration Pipeline

The API-based content migration consists of the following phases:

1. **Export/Download**: Use the tool to download all supported workspaces, projects, teamspaces, documents, cards, and templates from your source instance into a local folder.
2. **Review/Prepare**: Validate the downloaded files against Huly schemas, make any desired modifications or filtering offline, and prepare them for importing.
3. **Import**: Use the tool to push the local folder's data into the target Huly instance.
4. **Reconcile (SSO)**: Match and merge duplicate contact profiles created during import into the active SSO accounts once users log in.

---

## Gap & Loss Analysis

Because client APIs are constrained by Huly's permission model and transactor rules, certain high-level metadata changes when importing data over the API. Below is the list of gaps and how they are handled by the tool:

### 1. Comment Authors & Timestamps
- **The Gap**: Huly's API automatically stamps comments with the importing account's ID (`createdBy`) and the current time of import (`createdOn`). It does not allow custom author or date parameters to be set via API.
- **The Handling**: During export/download, the tool retrieves the original author's email and creation timestamp and prepends an attribution header to the comment body:
  `**[Author Email] on [Date/Time]:**\n\n[Original message]`
  This preserves the discussion context and chronology inside the comment thread.

### 2. Issue/Document Creator & Creation Date
- **The Gap**: Similar to comments, the original creator and creation date of issues, wiki documents, and cards are system-stamped by the server when the record is created in the target workspace.
- **The Handling**: The tool writes a metadata attribution header/footer directly in the issue description or document body:
  `*Created by [Creator Email] on [Date/Time]*`

### 3. Native Activity/Audit Logs (History)
- **The Gap**: Field transitions (e.g., changing status from *Backlog* to *In Progress*, reassigning, or changing priority) are system-generated and write-protected. They cannot be written or simulated by API clients.
- **The Handling**: Native transition logs will not be restored. However, the tool exports and imports the final state of all fields (status, assignee, priority, milestone, component, etc.) as of the export time, ensuring the target workspace is in the correct end state.

### 4. File Attachments
- **The Gap**: Images and files embedded in descriptions or wiki pages refer to workspace-specific file/blob IDs that will not exist in the target workspace.
- **The Handling**: File references are kept as-is in the markup. If a complete transfer of these media files is required, a direct [DB-to-DB migration](db-migration.md) should be performed instead.

---

## Step-by-Step CLI Walkthrough

### 1. Export content from Source
Run the `download` command to pull data into a target directory:
```bash
huly-data-xport download --workspace <source-workspace-slug> --out ./backup-data
```

### 2. Validate & Prepare
Validate the offline tree against the schemas to ensure referential integrity before import:
```bash
huly-data-xport validate --content ./backup-data
```

### 3. Import to Target
Configure target instance environment credentials (usually via `.env`), then run:
```bash
huly-data-xport import --content ./backup-data --workspace <target-workspace-slug>
```

### 4. Reconcile SSO Profiles
Once your team logs into the target instance using SSO, run:
```bash
huly-data-xport reconcile-people --workspace <target-workspace-slug> --apply
```
This merges duplicate import contacts into the active SSO profiles and re-homes their assignments.
