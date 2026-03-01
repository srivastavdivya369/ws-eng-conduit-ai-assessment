Implementation Plan

Requirement
- Co‑authors
  - Create Article page: add a new “Co-Authors” field.
  - Edit Article page: allow co-authors to edit the article.
- Edit locking
  - When a user opens an article editor, the article is locked for editing.
  - Lock is held until: the user saves, navigates away (closes editor), or 5 minutes pass after last heartbeat (“last seen online”).
  - The last successfully saved version is used (no merging).
- Lock handling UX
  - If an article is locked by someone else, other co-authors attempting to edit see a clear error.
  - If a user loses the lock (e.g., connectivity loss), they are informed accordingly.

High-level design
- Extend the Article data model to support multiple co-authors (ManyToMany with User).
- Introduce application-level, optimistic edit locks stored on Article (owner + timestamps) with 5-minute TTL and periodic heartbeats.
- Enforce “author OR co-author” permissions for editing; enforce active-lock ownership for saving.
- Add lock endpoints (acquire, heartbeat, release) and wire editor lifecycle to them on the frontend.

Backend (NestJS + MikroORM)
1) Data model & migration
- Article entity (backend/src/article/article.entity.ts)
  - Add: coAuthors: ManyToMany(() => User, { pivotTable: 'article_co_authors', hidden: true })
  - Add: lockOwner: ManyToOne(() => User, { nullable: true, fieldName: 'lock_owner_id', hidden: true })
  - Add: lockAcquiredAt: Date | null (fieldName: 'lock_acquired_at', hidden: true)
  - Add: lockLastSeenAt: Date | null (fieldName: 'lock_last_seen_at', hidden: true)
  - toJSON(user?): include coAuthors as Profile[] and optional canEdit boolean (derived).
- Migration (backend/src/migrations/XXXXXXXX_AddCoAuthorsAndLock.ts)
  - Create pivot table article_co_authors (article_id, user_id), PK(article_id, user_id), FKs to article(id), user(id).
  - Add nullable columns to article: lock_owner_id, lock_acquired_at, lock_last_seen_at with index on lock_owner_id.

2) DTOs & validation (backend/src/article/dto)
- Extend CreateArticleDto with optional coAuthorUsernames?: string[].
- Create UpdateArticleDto (Partial<CreateArticleDto>) or reuse CreateArticleDto in controller with Partial.
- Service resolves coAuthorUsernames -> User[]; if any username missing, return 400 with validation error.

3) Authorization & helpers (backend/src/article/article.service.ts)
- Helper ensureCanEdit(userId, article): boolean -> author.id === userId OR coAuthors contains userId. Throw 403 otherwise.
- Lock constants: const EDIT_LOCK_TTL_MS = 5 * 60 * 1000.
- Helper isLockActive(article): boolean -> lockOwner && now - lockLastSeenAt < EDIT_LOCK_TTL_MS.

4) Lock operations (ArticleService)
- acquireLock(userId, slug)
  - Transactionally set lockOwner=userId, lockAcquiredAt=now, lockLastSeenAt=now if:
    - lockOwner IS NULL OR lock expired OR lockOwner === userId.
  - If another active owner exists, return 423 Locked with { lockedBy }.
- heartbeatLock(userId, slug)
  - If lockOwner === userId and lock not expired -> update lockLastSeenAt=now.
  - Else return 409 Conflict (lock not held or expired/taken).
- releaseLock(userId, slug)
  - If lockOwner === userId -> null out lock fields; else 409 (optional no-op).

5) Create/Update Article (ArticleService)
- create(userId, dto)
  - Existing create flow + attach coAuthors resolved from coAuthorUsernames.
- update(userId, slug, dto)
  - ensureCanEdit first.
  - If isLockActive and lockOwner === userId -> proceed; else return 409/423 accordingly.
  - Update article fields (title/description/body/tagList + coAuthors), flush.
  - On success, release lock (per requirement: save releases lock).

6) Controllers & routes (backend/src/article/article.controller.ts)
- New endpoints (all Auth-protected via ArticleModule middleware):
  - POST /articles/:slug/lock -> acquireLock
  - PUT /articles/:slug/lock -> heartbeatLock
  - DELETE /articles/:slug/lock -> releaseLock
  - GET /articles/:slug/lock -> optional lock status for UX (lockedBy, expiresAt) 
- Include coAuthors (and optional canEdit) in GET article responses.

7) Module wiring (backend/src/article/article.module.ts)
- Ensure AuthMiddleware protects: /articles/:slug/lock (POST/PUT/DELETE/GET) in addition to existing routes.

Frontend (React + Redux)
1) Types & services
- types/article.ts
  - Extend Article with coAuthors?: Profile[] and canEdit?: boolean.
  - Extend ArticleForEditor with coAuthorUsernames: string[].
  - Update decoders accordingly.
- services/conduit.ts
  - Update createArticle/updateArticle payloads to include coAuthorUsernames.
  - Add acquireArticleLock(slug) [POST], heartbeatArticleLock(slug) [PUT], releaseArticleLock(slug) [DELETE].
  - Normalize 423 Locked -> friendly message with lockedBy; 409 Conflict -> “lock not held/expired”.

2) Editor state & UI
- ArticleEditor.slice.tsx
  - Extend initialState.article to include coAuthorUsernames: [] and coAuthor input text (like tag handling).
  - Add actions addCoAuthor/removeCoAuthor mirroring addTag/removeTag.
- ArticleEditor.tsx
  - Add a second list field for co-authors: name: 'coAuthor', listName: 'coAuthorUsernames', placeholder: 'Enter a co-author username and press enter'.
  - Reuse GenericForm list handling logic.
- Pages/NewArticle.tsx
  - Initialize editor; on submit include coAuthorUsernames; handle errors normally.
- Pages/EditArticle.tsx
  - On mount: load article; authorize via author/coAuthors (or canEdit flag from API).
  - Attempt to acquire lock immediately:
    - If 423 -> show error (via updateErrors) and navigate back to article page.
    - If acquired -> start heartbeat interval (e.g., every 60s) and clear on unmount.
  - On save success -> release lock; navigate to article page.
  - On unmount -> best-effort releaseLock; if fails, TTL handles cleanup.
  - If offline/heartbeat fails -> warn the user; on save, handle 409/423 and show “You no longer hold the edit lock.”

3) UX messaging
- While locked by another user: “This article is currently being edited by <username>. Try again later.”
- If lock lost: “You no longer hold the edit lock. Reload and try acquiring it again.”
- Disable form controls when lock is not held.

API status codes & errors
- 423 Locked: Another user holds active lock. Body example: { errors: { lock: ["Locked by <username>"] }, lockedBy: { username, image } }.
- 409 Conflict: Caller doesn’t hold the lock (heartbeat/release/save). Body: { errors: { lock: ["Edit lock not held"] } }.
- 403 Forbidden: Not author or co-author.
- Keep GenericErrors shape so UI errors render via <Errors />.

Concurrency & consistency
- Acquire lock via conditional update in a transaction:
  - WHERE slug=:slug AND (lock_owner_id IS NULL OR lock_last_seen_at < :expiry OR lock_owner_id=:me).
  - If 0 rows affected -> 423.
- Heartbeat is idempotent for the lock owner.
- Last-write-wins on successful save (no diff/merge).

Acceptance criteria (manual)
- Create with co-authors -> returned article includes coAuthors; co-author can open editor.
- Lock happy path: user acquires lock, edits, saves -> lock released.
- Lock contention: while A holds lock, B gets a lock error on editor open.
- TTL expiry: A stops heartbeats/times out -> after >5m, B can acquire lock; A gets 409/423 on save.
- Offline: heartbeats fail -> user warned; on save, appropriate error.

Key decisions
- Co-authors as ManyToMany(User) pivot (article_co_authors) rather than comma-separated emails
  - Alternatives: store emails as TEXT; separate join table model.
  - Rationale: fits existing MikroORM relations and keeps referential integrity and easy population.
- Application-level optimistic edit lock on Article
  - Alternatives: DB row-level locks; separate Lock entity/table; Redis.
  - Rationale: simple, visible, testable; works with current stack without additional infra.
- TTL 5 minutes with 60s heartbeat; last-write-wins
  - Alternatives: WebSockets; CRDTs or per-field merging.
  - Rationale: meets requirements with minimal complexity.

Notes
- No AWS infra changes required; locks are persisted in MySQL alongside Article records.
- Swagger docs will be updated for new lock endpoints.


Any additional notes that you think are relevant to the plan. For example, do we need to perform any changes to the AWS architecture to support the new feature? Briefly describe the changes you would need to make.
