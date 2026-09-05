---
name: api-design
description: Design an HTTP API contract as a reviewable document before implementation - resources, endpoints, request/response shapes, status codes, auth, errors, pagination, and versioning. Use when a frontend needs a backend, when two systems integrate, or before building any endpoint that something else will depend on.
---

# Design an API contract

The contract is what a frontend, an app or a partner depends on. Arguing about a JSON shape is free; changing a shipped endpoint that three clients call is not. So you write the contract down and review it *before* the handlers exist.

## 1. Model the resources

List the nouns the API exposes and the operations on each. Map operations to HTTP:

```
GET    /invoices            list (paginated, filterable)
POST   /invoices            create
GET    /invoices/{id}       read one
PATCH  /invoices/{id}       update some fields
DELETE /invoices/{id}       delete
POST   /invoices/{id}/send  a real action that is not CRUD - verb sub-resource
```

Nouns for resources, verbs for actions, HTTP methods for the CRUD. If you are reaching for `/doThing`, either it is a sub-resource action (fine) or the resource is modelled wrong (fix that).

## 2. Pin the shapes

For each endpoint, a worked example of the request and the success response — real field names, real types. This is the contract; be exact:

```
POST /invoices
{ "customerId": 42, "lines": [{ "sku": "A1", "qty": 2 }] }

201 Created
{ "id": 1007, "status": "draft", "total": "49.98", "createdAt": "2026-09-05T10:00:00Z" }
```

Money as a decimal string, not a float. Timestamps as ISO-8601 UTC. IDs consistent in type across the whole API.

## 3. Decide the conventions once, apply everywhere

- **Status codes** with meaning: 200/201, 400 (malformed), 401 vs 403 (not authenticated vs not allowed), 404, 409 (conflict), 422 (validation), 429 (rate limit), 5xx only for your faults.
- **One error shape** for the whole API:
  ```
  { "error": { "code": "validation_failed",
                "message": "The invoice could not be created.",
                "fields": { "lines": "At least one line is required." } } }
  ```
- **List endpoints**: pagination from day one (cursor over offset once data grows), documented `filter`/`sort`, a stable default order.
- **Auth**: state how a request authenticates (session cookie, bearer token) and that authorisation is checked per record, not just per login.

## 4. Write it as a document

An OpenAPI file is ideal — it is machine-readable, the frontend can generate a client, and it doubles as the test oracle. For a small API, a Markdown table of endpoints with the example pairs above is enough. Either way it goes in the repo and gets reviewed before code.

## 5. Plan for change

Mark, for anything already consumed, which changes are safe (additive: new optional field, new endpoint) and which are breaking (rename, retype, remove, tighten validation). Breaking changes need a version path or a deprecation window. Decide the versioning approach now (URL `/v1/` is simplest on this hosting) even if v1 is all there is.

## Ground it in the hosting

- A request that runs 30 seconds gets killed. Long work → 202 + a status URL + a cron-driven job the client polls. Design that into the contract, do not bolt it on.
- Rate-limit unauthenticated and expensive endpoints; on shared hosting an unthrottled endpoint is a self-inflicted outage.
- Webhooks you receive: verify the signature, respond 2xx fast, process after, and be idempotent — providers retry.

## Hand-offs

`api-engineer` implements the contract and owns the safety (validation, parameterised queries, auth-per-record); `db-steward` supplies the schema behind it; `frontend-builder` builds against the documented shapes in parallel; `test-engineer` tests the contract's edges; `web-pentester` checks the authorisation boundaries. The document you produce is what they all build against.
