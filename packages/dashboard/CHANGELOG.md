# @openworkflow/dashboard

## 0.1.8

- Add pagination to runs and step attempts, including conditional pagination
  controls
- Redesign the run details page
- Add Monaco-based JSON viewing and input experiences
- Improve dashboard layout and spacing, including mobile refinements
- Make status colors consistent
- Move sleeping-to-running status handling to the backend
- Add color to workflow stats cards (#314)
- Update TanStack dependencies (#352, #354, #361)

## 0.1.7

- Add child workflow visibility in run list and run details (#342)
- Treat legacy `sleeping` runs as `running` in dashboard status displays (#347)
- Merge legacy `sleeping` counts into `running` Prometheus metrics

## 0.1.6

- Switch to global backend run stats
- Add Prometheus `/metrics` endpoint

## 0.1.5

- Add button to cancel run (thanks @octoper!)

## 0.1.4

- Add create run form
- Improve workflow stats layout

## 0.1.3

- Add real-time polling to dashboard (#272) (thanks @szokeptr!)

## 0.1.2

- Suggest npx CLI command

## 0.1.1

- Update dependencies

## 0.1.0

- Initial release
