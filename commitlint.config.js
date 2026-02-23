import scopesConfig from "@commitlint/config-workspace-scopes";

export default {
  extends: [
    "@commitlint/config-conventional",
    "@commitlint/config-workspace-scopes",
  ],
  rules: {
    "scope-enum": async (ctx) => {
      const [severity, when, scopes] =
        await scopesConfig.rules["scope-enum"](ctx);
      return [
        severity,
        when,
        [
          ...scopes,
          "deps", // Dependabot
          "dev-deps", // Dependabot
          "release", // release commits
        ],
      ];
    },
  },
  prompt: {
    settings: {
      enableMultipleScopes: true,
    },
  },
};
