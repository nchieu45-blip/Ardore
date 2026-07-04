<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project rules

NEVER insert or modify rows in auth.users via raw SQL — always use the GoTrue Admin API (/auth/v1/admin/users). Raw SQL inserts corrupt GoTrue and break all authentication. This has broken production auth twice.
