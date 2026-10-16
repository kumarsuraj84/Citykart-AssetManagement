| # | Operation | n | Old median | Old p95 | New median | New p95 | Δ median (ms) | Ratio median | Ratio p95 | Verdict | Repeat run ratio (median) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sign-in (correct password) | 20 | 43.1 | 46.8 | 47.8 | 59.2 | +4.7 | 1.11 | 1.26 | OK | 1.05 (43.6 → 45.9) |
| 2 | Sign-in, one user every 7 s, new stack WITH rate limiting on | 15 | 43.7 | 50.9 | 47.7 | 54.2 | +4.1 | 1.09 | 1.06 | OK | – |
| 3 | Refused sign-in, unknown login id (AU-01 dummy hash) | 20 | 6.3 | 7.7 | 39.2 | 57.1 | +32.9 | 6.20 | 7.41 | By design (AU-01) | 6.91 (5.9 → 40.6) |
| 4 | Token refresh (rotating cookie) | 20 | 2.3 | 2.6 | 3.6 | 4.9 | +1.4 | 1.60 | 1.84 | OK | 1.48 (2.8 → 4.2) |
| 5 | Asset search, universal term 'laptop' (page 1) | 20 | 21.2 | 24.3 | 20.4 | 22.4 | -0.8 | 0.96 | 0.92 | OK | 0.97 (36.6 → 35.7) |
| 6 | Asset search, partial serial 'PFL0077' | 20 | 18.1 | 19.3 | 17.8 | 19.7 | -0.3 | 0.98 | 1.02 | OK | 0.98 (34.6 → 33.8) |
| 7 | Asset list filtered IN_STOCK + NON_IT, page 1 | 20 | 7.6 | 10.1 | 7.4 | 9.5 | -0.3 | 0.96 | 0.94 | OK | 0.98 (8.6 → 8.4) |
| 8 | Asset list IN_STOCK, deep page (offset 1500) | 20 | 8.2 | 9.8 | 7.9 | 8.6 | -0.3 | 0.97 | 0.88 | OK | 0.95 (8.6 → 8.2) |
| 9 | Asset 360 (detail + events + documents + changes, parallel) | 20 | 10.0 | 12.3 | 10.3 | 11.6 | +0.2 | 1.02 | 0.94 | OK | 1.05 (10.0 → 10.5) |
| 10 | PO list (first 200) | 20 | 12.9 | 14.1 | 12.7 | 14.1 | -0.2 | 0.99 | 1.00 | OK | 1.01 (14.9 → 15.0) |
| 11 | PO detail (header + line groups + units, parallel) | 20 | 11.1 | 13.1 | 11.2 | 12.4 | +0.1 | 1.01 | 0.95 | OK | 1.01 (12.1 → 12.3) |
| 12 | ERP copy PO list /api/erp/pos?envelope=true (local copy, 40 POs, no ERP link) | 20 | 16.7 | 18.2 | 16.8 | 18.9 | +0.1 | 1.00 | 1.04 | OK | 1.01 (17.7 → 17.9) |
| 13 | Reports: asset preview (50 rows) | 20 | 14.1 | 16.0 | 14.0 | 15.9 | -0.1 | 0.99 | 0.99 | OK | 1.03 (17.0 → 17.6) |
| 14 | Logs: audit trail query (50 rows) | 20 | 8.3 | 8.9 | 8.4 | 9.7 | +0.1 | 1.01 | 1.09 | OK | 1.02 (9.1 → 9.3) |
| 15 | Vendor create | 20 | 7.9 | 8.8 | 8.4 | 9.8 | +0.6 | 1.07 | 1.12 | OK | n/a (name clash) |
| 16 | Item create | 20 | 10.1 | 11.2 | 10.6 | 11.6 | +0.5 | 1.05 | 1.04 | OK | n/a (name clash) |
| 17 | Move 1 asset (stock room -> employee) | 15 | 9.7 | 12.3 | 10.2 | 12.4 | +0.5 | 1.05 | 1.00 | OK | 1.17 (12.3 → 14.4) |
| 18 | Bulk Move of 50 assets | 8 | 168.4 | 202.5 | 202.3 | 238.0 | +33.9 | 1.20 | 1.18 | OK | 1.15 (159.1 → 182.5) |
| 19 | Receive 1 unit (no-serial item) | 15 | 22.5 | 28.5 | 22.2 | 28.2 | -0.3 | 0.99 | 0.99 | OK | – |
| 20 | Receive 10 units (no-serial item) | 15 | 21.6 | 29.6 | 22.5 | 29.0 | +1.0 | 1.04 | 0.98 | OK | – |
| 21 | Receive 50 units (no-serial item) | 8 | 33.2 | 35.8 | 34.4 | 36.4 | +1.2 | 1.03 | 1.02 | OK | – |
| 22 | Receive 100 units (no-serial item) | 8 | 45.6 | 49.1 | 46.1 | 55.2 | +0.5 | 1.01 | 1.12 | OK | – |
| 23 | Receive 10 serial units | 15 | 23.9 | 27.7 | 24.8 | 29.1 | +1.0 | 1.04 | 1.05 | OK | – |
| 24 | Batch Add Assets x20 | 15 | 17.8 | 20.0 | 19.2 | 22.2 | +1.4 | 1.08 | 1.11 | OK | 1.05 (20.2 → 21.2) |
| 25 | Batch Add Assets x200 | 8 | 57.1 | 130.7 | 57.5 | 129.8 | +0.4 | 1.01 | 0.99 | OK | 1.05 (53.5 → 56.0) |
| 26 | Static index.html through nginx [796 B / 479 B] | 30 | 0.5 | 0.7 | 0.5 | 0.8 | +0.0 | 1.00 | 1.13 | OK | 1.02 (0.6 → 0.6) |
| 27 | Static main JS bundle through nginx (each stack's own build) [1372252 B / 1374248 B] | 30 | 6.7 | 8.9 | 6.6 | 11.4 | -0.2 | 0.98 | 1.28 | OK | 0.99 (7.4 → 7.3) |
| 28 | uvicorn /assets/<same JS file> (IF-01 lexical + resolve check; same dist in both) [1374248 B / 1374248 B] | 30 | 7.4 | 9.9 | 7.4 | 10.7 | 0.0 | 1.00 | 1.07 | OK | 1.01 (8.3 → 8.4) |
| 29 | uvicorn /assets/<missing file> (404 path) [70 B / 70 B] | 30 | 1.0 | 1.3 | 1.1 | 1.4 | +0.1 | 1.12 | 1.09 | OK | 1.13 (1.5 → 1.7) |
| 30 | 4 MB JSON body to the API directly (Vendor create, name too long -> 422) | 15 | 29.1 | 50.2 | 27.7 | 43.2 | -1.4 | 0.95 | 0.86 | OK | 1.11 (28.2 → 31.4) |
| 31 | Small JSON body to the API directly (same 422 route, 1 KB name) | 15 | 2.9 | 4.5 | 3.2 | 3.9 | +0.3 | 1.09 | 0.86 | OK | 1.01 (3.7 → 3.8) |
