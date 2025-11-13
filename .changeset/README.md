1. `npx @changesets/cli` to create a changeset file
2. `npx @changesets/cli version` to bump the versions according to changeset-specified
   versions
3. `npm i` to update the package-lock.json
4. Commit the version bump
5. `npx @changesets/cli publish` to publish the new version to npm
6. `git push --tags`
