1. `npx @changesets/cli` to create a changeset file
2. `npx @changesets/cli version` to bump the versions according to
   changeset-specified versions
3. `npm i` to update the package-lock.json
4. Make sure the README is updated to reflect any changes, since updates after
   publishing will not be shown on npm.
5. Commit the version bump
6. `npm login` to refresh the auth token
7. `npx @changesets/cli publish` to publish the new version to npm, which also
   creates git tags
8. `git push --tags`
