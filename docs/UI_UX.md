# UI/UX Specification

## Experience Principles
- Operational, dense, and scannable rather than marketing-style.
- Departmental ownership should be visible wherever users review controls, risks, evidence, and users.
- Super Admin tools should be powerful but hidden from normal navigation.
- Empty or missing data must show actionable states, not blank fields.

## Navigation
- Sidebar for desktop app sections.
- Bottom navigation for mobile signed-in sections.
- Hidden direct URL for `/super-admin` and `/super-admin/login`.

## Super Admin UX
- Identity tab: sync Clerk users, create local users, edit role/department/status/checks.
- Departments tab: create departments and bulk move users.
- Integrations tab: configure secrets, mark status, trigger sync.
- AI Providers tab: configure provider, model, endpoint, key, and active provider.
- Operations tab: simulation seed/run, operational signals, reset seed data.

## Responsive Rules
- Tables must have horizontal scroll with stable minimum width.
- Forms collapse to one column on mobile.
- Buttons use icon + label where space allows.
- No nested cards for page sections; cards are for repeated records and modals.

## States
- Loading: compact spinner/text.
- Empty: explain what is missing and what action creates it.
- Error: show specific fix, especially missing backend configuration.
- Success: short confirmation and automatic data refresh.

