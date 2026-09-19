declare const antiSlop: {
  rules: Record<
    string,
    { meta: { type: "problem" | "suggestion" | "layout" } }
  >;
};

export default antiSlop;
